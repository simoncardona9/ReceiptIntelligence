import { randomUUID } from "node:crypto";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
async function api(
  path: string,
  method = "GET",
  cookie?: string,
  body?: object,
  key?: string,
) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: new URL(base).origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${method} ${path}: ${response.status} ${raw.slice(0, 100)}`,
    );
  }
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.match(/ri_session=[^;]*/)?.[0],
  };
}
function expect(actual: number, wanted: number, label: string) {
  if (actual !== wanted)
    throw new Error(`${label}: ${actual}, expected ${wanted}`);
}
async function register() {
  const email = `records-${randomUUID()}@example.invalid`;
  expect(
    (
      await api("/api/auth/register", "POST", undefined, {
        email,
        password: "synthetic-passphrase-42",
      })
    ).status,
    200,
    "register",
  );
  const login = await api("/api/auth/login", "POST", undefined, {
    email,
    password: "synthetic-passphrase-42",
  });
  expect(login.status, 200, "login");
  return login.cookie!;
}
async function run() {
  const owner = await register(),
    editor = await register(),
    viewer = await register(),
    outsider = await register();
  const workspace = await api(
    "/api/workspaces",
    "POST",
    owner,
    { name: "Synthetic Approved" },
    randomUUID(),
  );
  expect(workspace.status, 201, "workspace");
  const workspaceId = (workspace.data.workspace as { id: string }).id;
  const root = `/api/workspaces/${workspaceId}`;
  for (const [cookie, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ]) {
    const request = await api(`${root}/access-requests`, "POST", cookie, {});
    expect(request.status, 200, "access request");
    expect(
      (
        await api(
          `${root}/access-requests/${(request.data.request as { id: string }).id}/decision`,
          "POST",
          owner,
          { decision: "approve", role },
        )
      ).status,
      200,
      "access approval",
    );
  }
  const manual = await api(
    `${root}/manual-expenses`,
    "POST",
    owner,
    {
      merchant: "Synthetic Grocer",
      date: "2026-11-01",
      totalMinor: 900,
      currency: "UYU",
      categoryName: "Hogar",
      lines: [
        { description: "Golden pears", quantityMilli: 1000, totalMinor: 900 },
      ],
    },
    randomUUID(),
  );
  expect(manual.status, 201, "manual expense");
  const originId = (manual.data.expense as { id: string }).id;
  const approval = await api(
    `${root}/review/manual/${originId}/lifecycle`,
    "POST",
    owner,
    { action: "approve", expectedVersion: 0, expectedBaseProposalId: null },
    randomUUID(),
  );
  expect(approval.status, 200, "approval");
  const purchaseId = (approval.data.review as { approvedPurchaseId: string })
    .approvedPurchaseId;
  const product = await api(
    `${root}/products`,
    "POST",
    editor,
    { action: "create", name: "Pears catalog", brand: null },
    randomUUID(),
  );
  expect(product.status, 200, "product create");
  expect(
    (
      await api(
        `${root}/products`,
        "POST",
        editor,
        {
          action: "link",
          purchaseId,
          lineIndex: 0,
          productId: (product.data as { id: string }).id,
          brand: null,
          confirmUncertain: true,
          expectedReviewVersion: 0,
        },
        randomUUID(),
      )
    ).status,
    200,
    "product link",
  );
  const listPath = `${root}/approved-records`;
  expect((await api(listPath, "GET", outsider)).status, 404, "outsider list");
  for (const query of [
    "Synthetic Grocer",
    "Golden pears",
    "Pears catalog",
    originId,
    purchaseId,
  ]) {
    const search = await api(
      `${listPath}?q=${encodeURIComponent(query)}`,
      "GET",
      viewer,
    );
    expect(search.status, 200, `search ${query}`);
    if (
      !(search.data.records as { id: string }[]).some(
        (record) => record.id === purchaseId,
      )
    )
      throw new Error(`Search missed ${query}`);
  }
  const detailPath = `${listPath}/${purchaseId}`;
  const detail = await api(detailPath, "GET", viewer);
  expect(detail.status, 200, "viewer detail");
  if (
    (detail.data.record as { role: string; fields: { lineItems: object[] } })
      .role !== "viewer" ||
    (detail.data.record as { fields: { lineItems: object[] } }).fields.lineItems
      .length !== 1
  )
    throw new Error("Viewer detail missing line or role");
  expect(
    (
      await api(
        detailPath,
        "POST",
        editor,
        { action: "archive", expectedArchived: false },
        randomUUID(),
      )
    ).status,
    403,
    "editor archive",
  );
  const archiveKey = randomUUID();
  expect(
    (
      await api(
        detailPath,
        "POST",
        owner,
        { action: "archive", expectedArchived: false },
        archiveKey,
      )
    ).status,
    200,
    "archive",
  );
  expect(
    (
      await api(
        detailPath,
        "POST",
        owner,
        { action: "archive", expectedArchived: false },
        archiveKey,
      )
    ).status,
    200,
    "archive retry",
  );
  expect(
    (
      await api(
        detailPath,
        "POST",
        owner,
        { action: "restore", expectedArchived: true },
        archiveKey,
      )
    ).status,
    409,
    "conflicting retry",
  );
  expect(
    (await api(detailPath, "GET", viewer)).status,
    404,
    "viewer archived detail",
  );
  expect(
    (await api(`${root}/manual-expenses/${originId}`, "GET", viewer)).status,
    404,
    "viewer archived origin",
  );
  expect(
    (await api(`${root}/review/manual/${originId}`, "GET", viewer)).status,
    404,
    "viewer archived review",
  );
  const archivedInbox = await api(`${root}/inbox`, "GET", viewer);
  if (
    (archivedInbox.data.entries as { id: string }[]).some(
      (entry) => entry.id === originId,
    )
  )
    throw new Error("Viewer inbox exposed archived manual expense");
  expect(
    (await api(`${listPath}?includeArchived=true`, "GET", viewer)).status,
    403,
    "viewer archived list",
  );
  if (
    (await api(listPath, "GET", owner)).data.records instanceof Array &&
    ((await api(listPath, "GET", owner)).data.records as { id: string }[]).some(
      (record) => record.id === purchaseId,
    )
  )
    throw new Error("Archived record appeared by default");
  const archived = await api(`${listPath}?includeArchived=true`, "GET", owner);
  expect(archived.status, 200, "owner archived list");
  if (
    !(archived.data.records as { id: string }[]).some(
      (record) => record.id === purchaseId,
    )
  )
    throw new Error("Owner cannot see archived record");
  expect(
    (
      await api(
        detailPath,
        "POST",
        owner,
        { action: "restore", expectedArchived: true },
        randomUUID(),
      )
    ).status,
    200,
    "restore",
  );
  expect(
    (await api(detailPath, "GET", viewer)).status,
    200,
    "viewer restored detail",
  );
  console.log("Synthetic approved-record smoke passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
