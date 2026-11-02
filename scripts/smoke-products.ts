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
  const email = `product-${randomUUID()}@example.invalid`;
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
    viewer = await register();
  const workspace = await api(
    "/api/workspaces",
    "POST",
    owner,
    { name: "Synthetic Products" },
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
      "access decision",
    );
  }
  const manual = await api(
    `${root}/manual-expenses`,
    "POST",
    owner,
    {
      merchant: "Synthetic Shop",
      date: "2026-11-01",
      totalMinor: 10000,
      currency: "UYU",
      categoryName: "Hogar",
      lines: [
        { description: "Leche entera", quantityMilli: 1000, totalMinor: 10000 },
      ],
    },
    randomUUID(),
  );
  expect(manual.status, 201, "manual expense");
  const manualId = (manual.data.expense as { id: string }).id;
  const review = await api(`${root}/review/manual/${manualId}`, "GET", owner);
  const reviewData = review.data.review as {
    version: number;
    baseProposalId: string | null;
  };
  const approval = await api(
    `${root}/review/manual/${manualId}/lifecycle`,
    "POST",
    owner,
    {
      expectedVersion: reviewData.version,
      expectedBaseProposalId: reviewData.baseProposalId,
      action: "approve",
    },
    randomUUID(),
  );
  expect(approval.status, 200, "approval");
  const purchaseId = (approval.data.review as { approvedPurchaseId: string })
    .approvedPurchaseId;
  const path = `${root}/products`;
  expect(
    (
      await api(
        path,
        "POST",
        viewer,
        { action: "create", name: "Leche entera", brand: null },
        randomUUID(),
      )
    ).status,
    403,
    "viewer create",
  );
  const createKey = randomUUID();
  const created = await api(
    path,
    "POST",
    editor,
    { action: "create", name: "Leche entera", brand: null },
    createKey,
  );
  expect(created.status, 200, "product create");
  const productId = (created.data as { id: string }).id;
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "create", name: "Leche entera", brand: null },
        createKey,
      )
    ).status,
    200,
    "create retry",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "create", name: "Other", brand: null },
        createKey,
      )
    ).status,
    409,
    "conflicting retry",
  );
  const suggestion = await api(`${path}?suggest=LECHE%20ENTERA`, "GET", viewer);
  if (
    !(
      suggestion.data.result as {
        product: { id: string };
        confidence: string;
      }[]
    ).some(
      (item) => item.product.id === productId && item.confidence === "high",
    )
  )
    throw new Error("Exact match missing");
  const lines = await api(`${path}?purchaseId=${purchaseId}`, "GET", viewer);
  expect(lines.status, 200, "viewer lines");
  const version = (lines.data.result as { reviewVersion: number })
    .reviewVersion;
  const body = {
    action: "link",
    purchaseId,
    lineIndex: 0,
    productId,
    brand: null,
    confirmUncertain: false,
    expectedReviewVersion: version,
  };
  expect(
    (await api(path, "POST", viewer, body, randomUUID())).status,
    403,
    "viewer link",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { ...body, expectedReviewVersion: version + 1 },
        randomUUID(),
      )
    ).status,
    409,
    "stale version",
  );
  expect(
    (await api(path, "POST", editor, body, randomUUID())).status,
    200,
    "exact link",
  );
  const linked = await api(`${path}?purchaseId=${purchaseId}`, "GET", viewer);
  if (
    (
      linked.data.result as {
        lines: { description: string; link: { productId: string } }[];
      }
    ).lines[0].description !== "Leche entera" ||
    (linked.data.result as { lines: { link: { productId: string } }[] })
      .lines[0].link.productId !== productId
  )
    throw new Error("Description changed or link missing");
  const branded = await api(
    path,
    "POST",
    owner,
    { action: "create", name: "Leche entera", brand: "Marca A" },
    randomUUID(),
  );
  expect(branded.status, 200, "branded create");
  const brandedId = (branded.data as { id: string }).id;
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { ...body, productId: brandedId },
        randomUUID(),
      )
    ).status,
    409,
    "brand confirmation required",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { ...body, productId: brandedId, confirmUncertain: true },
        randomUUID(),
      )
    ).status,
    200,
    "brand confirmed",
  );
  console.log("Synthetic product smoke passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
