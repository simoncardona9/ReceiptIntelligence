import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresAuthWorkspaceRepository } from "../src/server/adapters/postgres/auth-workspace-repository";
import { IdentityService } from "../src/server/auth/identity-service";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const origin = new URL(baseUrl).origin;
const password = "synthetic-passphrase-42";

type ApiResult = {
  response: Response;
  body: Record<string, unknown>;
};

async function api(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
    origin?: string;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Origin: options.origin ?? origin,
    ...options.headers,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { response, body };
}

function nestedString(
  source: Record<string, unknown>,
  parent: string,
  property: string,
): string {
  const value = source[parent];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Response is missing ${parent}.${property}`);
  }
  const result = (value as Record<string, unknown>)[property];
  if (typeof result !== "string") {
    throw new Error(`Response is missing ${parent}.${property}`);
  }
  return result;
}

function expectStatus(result: ApiResult, status: number, step: string): void {
  if (result.response.status !== status) {
    throw new Error(
      `${step} expected HTTP ${status}, received ${result.response.status}`,
    );
  }
}

function sessionCookie(result: ApiResult): string {
  const setCookie = result.response.headers.get("set-cookie");
  const cookie = setCookie?.match(/ri_session=[^;]*/)?.[0];
  if (!cookie)
    throw new Error("Authentication response did not set a session cookie");
  if (
    !setCookie?.includes("HttpOnly") ||
    !setCookie.includes("SameSite=Lax") ||
    !setCookie.includes("Max-Age=604800")
  ) {
    throw new Error("Session cookie security attributes are incomplete");
  }
  return cookie;
}

async function register() {
  const email = `synthetic-${randomUUID()}@example.invalid`;
  const result = await api("/api/auth/register", {
    method: "POST",
    body: { email, password },
  });
  expectStatus(result, 200, "registration");
  if (
    JSON.stringify(result.body) !==
    JSON.stringify({ status: "continue_to_sign_in" })
  ) {
    throw new Error("Registration did not return its generic response");
  }
  if (result.response.headers.has("set-cookie")) {
    throw new Error("Registration unexpectedly created a session");
  }
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expectStatus(login, 200, "sign in after registration");
  return { email, cookie: sessionCookie(login) };
}

async function verifyAuditIsAppendOnly() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const event = await client.query<{ id: string }>(
      "SELECT id FROM auth_audit_events LIMIT 1",
    );
    if (!event.rows[0]) throw new Error("Expected a synthetic audit event");

    const mutationAttempts = [
      {
        query:
          "UPDATE auth_audit_events SET metadata = '{}'::jsonb WHERE id = $1",
        label: "update",
      },
      { query: "DELETE FROM auth_audit_events WHERE id = $1", label: "delete" },
    ];
    for (const attempt of mutationAttempts) {
      await client.query("BEGIN");
      try {
        await client.query(attempt.query, [event.rows[0].id]);
      } catch (error) {
        await client.query("ROLLBACK");
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
        if (code !== "P0001") throw error;
        continue;
      }

      await client.query("ROLLBACK");
      throw new Error(`Audit event ${attempt.label} was not rejected`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function verifySourceAuditIsAppendOnly(sourceId: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const event = await pool.query<{ id: string }>(
      "SELECT id FROM source_audit_events WHERE source_file_id = $1 LIMIT 1",
      [sourceId],
    );
    if (!event.rows[0]) throw new Error("Expected a source audit event");
    for (const query of [
      "UPDATE source_audit_events SET action = 'source_uploaded' WHERE id = $1",
      "DELETE FROM source_audit_events WHERE id = $1",
    ]) {
      try {
        await pool.query(query, [event.rows[0].id]);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
        if (code === "P0001") continue;
        throw error;
      }
      throw new Error("Source audit event mutation was not rejected");
    }
  } finally {
    await pool.end();
  }
}

async function verifyBootstrapIsIdempotent() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const repository = new PostgresAuthWorkspaceRepository(pool);
  const identity = new IdentityService(repository);
  const email = `synthetic-bootstrap-${randomUUID()}@example.invalid`;
  const password = `Synthetic-${randomUUID()}-Passphrase`;
  try {
    const first = await identity.bootstrapOwner(
      email,
      password,
      "Synthetic Bootstrap Home",
    );
    const original = await repository.findUserByEmail(email);
    const retry = await identity.bootstrapOwner(
      email,
      `Different-${randomUUID()}-Passphrase`,
      "Different Workspace",
    );
    const repeated = await repository.findUserByEmail(email);
    if (
      !first ||
      retry ||
      !original ||
      repeated?.passwordHash !== original.passwordHash
    ) {
      throw new Error("Bootstrap retry changed an existing account");
    }
    const state = await pool.query<{
      workspaceCount: string;
      ownerCount: string;
      registrationAudits: string;
      workspaceAudits: string;
    }>(
      `SELECT
         (SELECT count(*) FROM workspaces WHERE created_by = $1)::text AS "workspaceCount",
         (SELECT count(*) FROM memberships WHERE user_id = $1 AND role = 'owner')::text AS "ownerCount",
         (SELECT count(*) FROM auth_audit_events WHERE actor_user_id = $1 AND action = 'account_registered')::text AS "registrationAudits",
         (SELECT count(*) FROM auth_audit_events WHERE actor_user_id = $1 AND action = 'workspace_created')::text AS "workspaceAudits"`,
      [original.id],
    );
    if (
      state.rows[0]?.workspaceCount !== "1" ||
      state.rows[0]?.ownerCount !== "1" ||
      state.rows[0]?.registrationAudits !== "1" ||
      state.rows[0]?.workspaceAudits !== "1"
    ) {
      throw new Error("Bootstrap did not create one audited owner workspace");
    }
  } finally {
    await pool.end();
  }
}

async function verifyConfiguredBootstrapLogin() {
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!email || !password) return;

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expectStatus(login, 200, "configured bootstrap owner login");
  const session = await api("/api/auth/session", {
    cookie: sessionCookie(login),
  });
  expectStatus(session, 200, "configured bootstrap owner session");
  const workspaces = session.body.workspaces;
  if (
    !Array.isArray(workspaces) ||
    !workspaces.some(
      (workspace) =>
        typeof workspace === "object" &&
        workspace !== null &&
        "role" in workspace &&
        workspace.role === "owner",
    )
  ) {
    throw new Error("Configured bootstrap account has no owner workspace");
  }
}

async function run() {
  await verifyBootstrapIsIdempotent();
  await verifyConfiguredBootstrapLogin();
  for (const path of ["/", "/login", "/register", "/workspaces"]) {
    const page = await fetch(new URL(path, baseUrl));
    if (page.status !== 200) {
      throw new Error(`${path} expected HTTP 200, received ${page.status}`);
    }
  }

  const owner = await register();
  const duplicateAccount = await api("/api/auth/register", {
    method: "POST",
    body: { email: owner.email, password },
  });
  expectStatus(duplicateAccount, 200, "duplicate registration");
  if (
    JSON.stringify(duplicateAccount.body) !==
      JSON.stringify({ status: "continue_to_sign_in" }) ||
    duplicateAccount.response.headers.has("set-cookie")
  ) {
    throw new Error("Duplicate registration response revealed account state");
  }

  const key = randomUUID();
  const created = await api("/api/workspaces", {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": key },
    body: { name: "Synthetic Household" },
  });
  expectStatus(created, 201, "workspace creation");
  const workspaceId = nestedString(created.body, "workspace", "id");

  const repeated = await api("/api/workspaces", {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": key },
    body: { name: "Synthetic Household" },
  });
  expectStatus(repeated, 201, "idempotent workspace retry");
  if (nestedString(repeated.body, "workspace", "id") !== workspaceId) {
    throw new Error("Workspace retry created a duplicate");
  }

  const missingIdempotencyKey = await api("/api/workspaces", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Another Synthetic Workspace" },
  });
  expectStatus(missingIdempotencyKey, 400, "missing workspace idempotency key");
  const invalidWorkspaceName = await api("/api/workspaces", {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": randomUUID() },
    body: { name: "   " },
  });
  expectStatus(invalidWorkspaceName, 400, "invalid workspace name");

  const conflictingRetry = await api("/api/workspaces", {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": key },
    body: { name: "Different Synthetic Workspace" },
  });
  expectStatus(conflictingRetry, 409, "idempotency key reuse");
  const ownerSession = await api("/api/auth/session", { cookie: owner.cookie });
  expectStatus(ownerSession, 200, "owner session after failed retry");
  if (
    !Array.isArray(ownerSession.body.workspaces) ||
    ownerSession.body.workspaces.length !== 1
  ) {
    throw new Error("Failed workspace retry left partial state");
  }

  const viewer = await register();
  const request = await api(`/api/workspaces/${workspaceId}/access-requests`, {
    method: "POST",
    cookie: viewer.cookie,
    body: {},
  });
  expectStatus(request, 200, "access request");
  const requestId = nestedString(request.body, "request", "id");
  const repeatedRequest = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    {
      method: "POST",
      cookie: viewer.cookie,
      body: {},
    },
  );
  expectStatus(repeatedRequest, 200, "idempotent access request retry");
  if (nestedString(repeatedRequest.body, "request", "id") !== requestId) {
    throw new Error("Access request retry created a duplicate");
  }

  const nonOwnerList = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    {
      cookie: viewer.cookie,
    },
  );
  expectStatus(nonOwnerList, 404, "non-owner request list");

  const ownerRequests = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    {
      cookie: owner.cookie,
    },
  );
  expectStatus(ownerRequests, 200, "owner request list");
  const pendingRequests = ownerRequests.body.requests;
  const firstPending = Array.isArray(pendingRequests)
    ? (pendingRequests[0] as Record<string, unknown> | undefined)
    : undefined;
  if (
    !Array.isArray(pendingRequests) ||
    pendingRequests.length !== 1 ||
    firstPending?.email !== viewer.email
  ) {
    throw new Error("Owner did not receive the expected pending request");
  }

  const outsiderDecision = await api(
    `/api/workspaces/${workspaceId}/access-requests/${requestId}/decision`,
    {
      method: "POST",
      cookie: viewer.cookie,
      body: { decision: "approve", role: "viewer" },
    },
  );
  expectStatus(outsiderDecision, 404, "non-owner approval attempt");

  const approved = await api(
    `/api/workspaces/${workspaceId}/access-requests/${requestId}/decision`,
    {
      method: "POST",
      cookie: owner.cookie,
      body: { decision: "approve", role: "viewer" },
    },
  );
  expectStatus(approved, 200, "owner approval");
  const repeatedApproval = await api(
    `/api/workspaces/${workspaceId}/access-requests/${requestId}/decision`,
    {
      method: "POST",
      cookie: owner.cookie,
      body: { decision: "approve", role: "viewer" },
    },
  );
  expectStatus(repeatedApproval, 200, "idempotent approval retry");

  const memberRequestRetry = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    { method: "POST", cookie: viewer.cookie, body: {} },
  );
  expectStatus(memberRequestRetry, 409, "access request by existing member");
  const viewerRequestList = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    { cookie: viewer.cookie },
  );
  expectStatus(viewerRequestList, 403, "viewer request list");

  const selection = await api(`/api/workspaces/${workspaceId}/select`, {
    method: "POST",
    cookie: viewer.cookie,
  });
  expectStatus(selection, 200, "workspace selection");
  const session = await api("/api/auth/session", { cookie: viewer.cookie });
  expectStatus(session, 200, "workspace session lookup");
  const sessionWorkspaces = session.body.workspaces;
  const firstMembership = Array.isArray(sessionWorkspaces)
    ? (sessionWorkspaces[0] as Record<string, unknown> | undefined)
    : undefined;
  if (
    session.body.activeWorkspaceId !== workspaceId ||
    firstMembership?.role !== "viewer"
  ) {
    throw new Error("Approved membership or active workspace was not returned");
  }

  const editorCandidate = await register();
  const editorRequest = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    {
      method: "POST",
      cookie: editorCandidate.cookie,
      body: {},
    },
  );
  expectStatus(editorRequest, 200, "editor access request");
  const viewerApprovalAttempt = await api(
    `/api/workspaces/${workspaceId}/access-requests/${nestedString(editorRequest.body, "request", "id")}/decision`,
    {
      method: "POST",
      cookie: viewer.cookie,
      body: { decision: "approve", role: "editor" },
    },
  );
  expectStatus(viewerApprovalAttempt, 403, "viewer approval attempt");
  const editorApproval = await api(
    `/api/workspaces/${workspaceId}/access-requests/${nestedString(editorRequest.body, "request", "id")}/decision`,
    {
      method: "POST",
      cookie: owner.cookie,
      body: { decision: "approve", role: "editor" },
    },
  );
  expectStatus(editorApproval, 200, "owner editor approval");
  const editorSession = await api("/api/auth/session", {
    cookie: editorCandidate.cookie,
  });
  expectStatus(editorSession, 200, "editor membership session");
  const editorMemberships = editorSession.body.workspaces;
  const editorMembership = Array.isArray(editorMemberships)
    ? (editorMemberships[0] as Record<string, unknown> | undefined)
    : undefined;
  if (editorMembership?.role !== "editor") {
    throw new Error("Owner approval did not create the editor membership");
  }

  const syntheticPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const sourceUploadKey = randomUUID();
  const upload = async (
    cookie: string,
    bytes = syntheticPng,
    type = "image/png",
    key = randomUUID(),
  ) =>
    fetch(new URL(`/api/workspaces/${workspaceId}/sources`, baseUrl), {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": type,
        "X-Source-Filename": "synthetic.png",
        "Idempotency-Key": key,
      },
      body: bytes,
    });
  const viewerUpload = await upload(viewer.cookie);
  expectStatus(
    { response: viewerUpload, body: {} },
    403,
    "viewer source upload",
  );
  const invalidSource = await upload(
    owner.cookie,
    new Uint8Array([1, 2, 3]),
    "image/png",
  );
  expectStatus(
    { response: invalidSource, body: {} },
    400,
    "invalid source signature",
  );
  const uploaded = await upload(
    owner.cookie,
    syntheticPng,
    "image/png",
    sourceUploadKey,
  );
  if (uploaded.status !== 201)
    throw new Error(
      `source upload expected HTTP 201, received ${uploaded.status}`,
    );
  const uploadedBody = (await uploaded.json()) as {
    source?: Record<string, unknown>;
  };
  const source = uploadedBody.source;
  if (
    typeof source?.id !== "string" ||
    typeof source.contentHash !== "string" ||
    "storageKey" in source
  ) {
    throw new Error(
      "Source upload returned invalid or private storage metadata",
    );
  }
  const sourceId = source.id;
  const uploadRetry = await upload(
    owner.cookie,
    syntheticPng,
    "image/png",
    sourceUploadKey,
  );
  if (uploadRetry.status !== 201)
    throw new Error("Source upload retry did not succeed");
  const retriedSource = (await uploadRetry.json()) as {
    source?: Record<string, unknown>;
  };
  if (retriedSource.source?.id !== sourceId)
    throw new Error("Source upload retry created a duplicate source");
  const conflictingUploadRetry = await upload(
    owner.cookie,
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 2]),
    "image/png",
    sourceUploadKey,
  );
  if (conflictingUploadRetry.status !== 409)
    throw new Error(
      "Reused source idempotency key with different content was accepted",
    );
  const viewerDownload = await fetch(
    new URL(`/api/workspaces/${workspaceId}/sources/${sourceId}`, baseUrl),
    {
      headers: { Cookie: viewer.cookie },
    },
  );
  if (
    viewerDownload.status !== 200 ||
    new Uint8Array(await viewerDownload.arrayBuffer()).toString() !==
      syntheticPng.toString()
  ) {
    throw new Error(
      "Authorized viewer could not download the original source bytes",
    );
  }
  const outsider = await register();
  const deniedDownload = await fetch(
    new URL(`/api/workspaces/${workspaceId}/sources/${sourceId}`, baseUrl),
    { headers: { Cookie: outsider.cookie } },
  );
  if (deniedDownload.status !== 404)
    throw new Error("Non-member source download was not hidden");
  const deniedRemoval = await fetch(
    new URL(`/api/workspaces/${workspaceId}/sources/${sourceId}`, baseUrl),
    {
      method: "DELETE",
      headers: { Origin: origin, Cookie: viewer.cookie },
    },
  );
  if (deniedRemoval.status !== 403)
    throw new Error("Viewer source removal was not rejected");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const removed = await fetch(
      new URL(`/api/workspaces/${workspaceId}/sources/${sourceId}`, baseUrl),
      {
        method: "DELETE",
        headers: { Origin: origin, Cookie: editorCandidate.cookie },
      },
    );
    if (removed.status !== 200)
      throw new Error(
        `Editor source removal expected HTTP 200, received ${removed.status}`,
      );
  }
  const removedDownload = await fetch(
    new URL(`/api/workspaces/${workspaceId}/sources/${sourceId}`, baseUrl),
    { headers: { Cookie: owner.cookie } },
  );
  if (removedDownload.status !== 404)
    throw new Error("Removed source remained downloadable");
  const sourceAuditPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const sourceAudit = await sourceAuditPool.query<{
    action: string;
    count: string;
  }>(
    "SELECT action, count(*)::text AS count FROM source_audit_events WHERE source_file_id = $1 GROUP BY action",
    [sourceId],
  );
  await sourceAuditPool.end();
  const actionCounts = new Map(
    sourceAudit.rows.map((row) => [row.action, Number(row.count)]),
  );
  if (
    actionCounts.get("source_uploaded") !== 1 ||
    actionCounts.get("source_downloaded") !== 1 ||
    actionCounts.get("source_removed") !== 1
  ) {
    throw new Error(
      "Source operations did not produce exactly one upload, download, and removal audit event",
    );
  }
  await verifySourceAuditIsAppendOnly(sourceId);
  const editorRequestList = await api(
    `/api/workspaces/${workspaceId}/access-requests`,
    { cookie: editorCandidate.cookie },
  );
  expectStatus(editorRequestList, 403, "editor request list");

  const secondWorkspace = await api("/api/workspaces", {
    method: "POST",
    cookie: viewer.cookie,
    headers: { "Idempotency-Key": randomUUID() },
    body: { name: "Synthetic Personal Workspace" },
  });
  expectStatus(secondWorkspace, 201, "second workspace creation");
  const secondWorkspaceId = nestedString(
    secondWorkspace.body,
    "workspace",
    "id",
  );
  const secondWorkspaceSourceUpload = await fetch(
    new URL(`/api/workspaces/${secondWorkspaceId}/sources`, baseUrl),
    {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: viewer.cookie,
        "Content-Type": "image/png",
        "X-Source-Filename": "other-workspace.png",
        "Idempotency-Key": randomUUID(),
      },
      body: syntheticPng,
    },
  );
  if (secondWorkspaceSourceUpload.status !== 201) {
    throw new Error("Owner could not upload a source to the second workspace");
  }
  const otherWorkspaceSourceBody =
    (await secondWorkspaceSourceUpload.json()) as {
      source?: Record<string, unknown>;
    };
  const otherWorkspaceSourceId = otherWorkspaceSourceBody.source?.id;
  if (typeof otherWorkspaceSourceId !== "string") {
    throw new Error("Second workspace source upload omitted its source ID");
  }
  const crossWorkspaceSource = await fetch(
    new URL(
      `/api/workspaces/${workspaceId}/sources/${otherWorkspaceSourceId}`,
      baseUrl,
    ),
    { headers: { Cookie: owner.cookie } },
  );
  if (crossWorkspaceSource.status !== 404) {
    throw new Error("Cross-workspace source identifier was not hidden");
  }
  const cleanedSecondWorkspaceSource = await fetch(
    new URL(
      `/api/workspaces/${secondWorkspaceId}/sources/${otherWorkspaceSourceId}`,
      baseUrl,
    ),
    { method: "DELETE", headers: { Origin: origin, Cookie: viewer.cookie } },
  );
  if (cleanedSecondWorkspaceSource.status !== 200) {
    throw new Error("Synthetic second-workspace source cleanup failed");
  }
  const multiWorkspaceSession = await api("/api/auth/session", {
    cookie: viewer.cookie,
  });
  expectStatus(multiWorkspaceSession, 200, "multiple workspace membership");
  if (
    !Array.isArray(multiWorkspaceSession.body.workspaces) ||
    multiWorkspaceSession.body.workspaces.length !== 2
  ) {
    throw new Error("User does not see both workspace memberships");
  }
  const switchedBack = await api(`/api/workspaces/${workspaceId}/select`, {
    method: "POST",
    cookie: viewer.cookie,
  });
  expectStatus(switchedBack, 200, "switching between workspaces");

  const crossWorkspace = await api(
    `/api/workspaces/${randomUUID()}/access-requests/${nestedString(editorRequest.body, "request", "id")}/decision`,
    { method: "POST", cookie: owner.cookie, body: { decision: "decline" } },
  );
  expectStatus(crossWorkspace, 404, "cross-workspace request identifier");

  const badOrigin = await api("/api/auth/logout", {
    method: "POST",
    cookie: viewer.cookie,
    origin: "https://attacker.example",
  });
  expectStatus(badOrigin, 403, "cross-origin mutation");

  const logout = await api("/api/auth/logout", {
    method: "POST",
    cookie: viewer.cookie,
  });
  expectStatus(logout, 200, "logout");
  const revokedSession = await api("/api/auth/session", {
    cookie: viewer.cookie,
  });
  expectStatus(revokedSession, 401, "revoked session");

  const successfulLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: viewer.email, password },
  });
  expectStatus(successfulLogin, 200, "valid login");
  const loginSession = await api("/api/auth/session", {
    cookie: sessionCookie(successfulLogin),
  });
  expectStatus(loginSession, 200, "login session");

  const knownBadPassword = await api("/api/auth/login", {
    method: "POST",
    body: { email: viewer.email, password: "incorrect synthetic password" },
  });
  const unknownAccount = await api("/api/auth/login", {
    method: "POST",
    body: { email: `missing-${randomUUID()}@example.invalid`, password },
  });
  expectStatus(knownBadPassword, 401, "invalid password");
  expectStatus(unknownAccount, 401, "unknown account");
  if (
    JSON.stringify(knownBadPassword.body) !==
    JSON.stringify(unknownAccount.body)
  ) {
    throw new Error("Login failures disclose whether an account exists");
  }

  const invalidWorkspace = await api(
    `/api/workspaces/${randomUUID()}/access-requests`,
    { cookie: viewer.cookie },
  );
  expectStatus(
    invalidWorkspace,
    401,
    "unauthenticated workspace request listing",
  );

  await verifyAuditIsAppendOnly();

  console.info(
    "Bootstrap, authentication, workspace, and private source storage smoke checks passed with synthetic data.",
  );
}

run().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Authentication smoke check failed.",
  );
  process.exitCode = 1;
});
