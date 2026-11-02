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
  const email = `allocation-${randomUUID()}@example.invalid`;
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
    { name: "Synthetic Allocations" },
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
  expect(
    (
      await api(
        `${root}/categories`,
        "POST",
        owner,
        { action: "seed" },
        randomUUID(),
      )
    ).status,
    200,
    "category seed",
  );
  const categories = (await api(`${root}/categories`, "GET", viewer)).data
    .categories as { id: string; name: string }[];
  const primary = categories.find(
    (item) => item.name === "Hogar y supermercado",
  )!.id;
  const other = categories.find((item) => item.name === "Salud")!.id;
  const manual = await api(
    `${root}/manual-expenses`,
    "POST",
    owner,
    {
      merchant: "Synthetic Shop",
      date: "2026-11-01",
      totalMinor: 1200,
      currency: "UYU",
      categoryName: "Hogar",
      lines: [
        { description: "Synthetic A", quantityMilli: 1000, totalMinor: 400 },
        { description: "Synthetic B", quantityMilli: 1000, totalMinor: 600 },
      ],
    },
    randomUUID(),
  );
  expect(manual.status, 201, "manual expense");
  const manualId = (manual.data.expense as { id: string }).id;
  const reviewPath = `${root}/review/manual/${manualId}`;
  const review = (await api(reviewPath, "GET", owner)).data.review as {
    current: Record<string, unknown>;
  };
  const corrected = await api(
    reviewPath,
    "PATCH",
    owner,
    {
      expectedVersion: 0,
      expectedBaseProposalId: null,
      reason: "Explicit synthetic receipt tax",
      fields: {
        ...review.current,
        subtotalMinor: 1000,
        taxMinor: 200,
        taxUnknown: false,
      },
    },
    randomUUID(),
  );
  expect(corrected.status, 200, "tax correction");
  const approval = await api(
    `${reviewPath}/lifecycle`,
    "POST",
    owner,
    { action: "approve", expectedVersion: 1, expectedBaseProposalId: null },
    randomUUID(),
  );
  expect(approval.status, 200, "approval");
  const purchaseId = (approval.data.review as { approvedPurchaseId: string })
    .approvedPurchaseId;
  const path = `${root}/allocations`;
  const body = {
    purchaseId,
    expectedReviewVersion: 1,
    primaryCategoryId: primary,
    groups: [{ categoryId: other, lineIndexes: [0] }],
  };
  expect((await api(path, "GET", outsider)).status, 400, "missing purchase ID");
  expect(
    (await api(`${path}?purchaseId=${purchaseId}`, "GET", outsider)).status,
    404,
    "outsider read",
  );
  expect(
    (await api(path, "POST", viewer, body, randomUUID())).status,
    403,
    "viewer write",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { ...body, expectedReviewVersion: 0 },
        randomUUID(),
      )
    ).status,
    409,
    "stale version",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { ...body, groups: [{ categoryId: other, lineIndexes: [0, 0] }] },
        randomUUID(),
      )
    ).status,
    400,
    "duplicate line",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        {
          ...body,
          groups: [
            { categoryId: other, lineIndexes: [0], overrideAmountMinor: 500 },
          ],
        },
        randomUUID(),
      )
    ).status,
    400,
    "missing reason",
  );
  const key = randomUUID();
  expect(
    (await api(path, "POST", editor, body, key)).status,
    200,
    "allocation",
  );
  expect((await api(path, "POST", editor, body, key)).status, 200, "retry");
  expect(
    (await api(path, "POST", editor, { ...body, groups: [] }, key)).status,
    409,
    "conflicting retry",
  );
  const result = (await api(`${path}?purchaseId=${purchaseId}`, "GET", viewer))
    .data.result as {
    allocations: { amountMinor: number; kind: string }[];
    taxMinor: number;
    totalMinor: number;
  };
  if (
    result.taxMinor !== 200 ||
    result.totalMinor !== 1200 ||
    result.allocations.reduce((sum, row) => sum + row.amountMinor, 0) !==
      1200 ||
    !result.allocations.some(
      (row) => row.kind === "remainder" && row.amountMinor === 800,
    )
  )
    throw new Error("Allocation reconciliation or receipt tax changed");
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        {
          ...body,
          groups: [
            {
              categoryId: other,
              lineIndexes: [0],
              overrideAmountMinor: 500,
              reason: "Synthetic correction",
            },
          ],
        },
        randomUUID(),
      )
    ).status,
    200,
    "reasoned correction",
  );
  console.log("Synthetic allocation smoke passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
