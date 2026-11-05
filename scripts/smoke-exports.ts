import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
async function request(
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
  const content = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    data: content.includes("application/json") ? await response.json() : null,
    bytes: content.includes("application/zip")
      ? new Uint8Array(await response.arrayBuffer())
      : null,
    cookie: response.headers.get("set-cookie")?.match(/ri_session=[^;]*/)?.[0],
  };
}
function status(actual: number, expected: number, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: ${actual}, expected ${expected}`);
}
async function user() {
  const email = `exports-${randomUUID()}@example.invalid`;
  status(
    (
      await request("/api/auth/register", "POST", undefined, {
        email,
        password: "synthetic-passphrase-42",
      })
    ).status,
    200,
    "register",
  );
  const login = await request("/api/auth/login", "POST", undefined, {
    email,
    password: "synthetic-passphrase-42",
  });
  status(login.status, 200, "login");
  return login.cookie!;
}
async function run() {
  const owner = await user(),
    editor = await user(),
    viewer = await user(),
    outsider = await user();
  const workspace = await request(
    "/api/workspaces",
    "POST",
    owner,
    { name: "Synthetic Export" },
    randomUUID(),
  );
  status(workspace.status, 201, "workspace");
  const root = `/api/workspaces/${workspace.data.workspace.id}`;
  for (const [cookie, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ]) {
    const access = await request(`${root}/access-requests`, "POST", cookie, {});
    status(access.status, 200, "access request");
    status(
      (
        await request(
          `${root}/access-requests/${access.data.request.id}/decision`,
          "POST",
          owner,
          { decision: "approve", role },
        )
      ).status,
      200,
      "access approve",
    );
  }
  const ids: string[] = [];
  for (const merchant of ["Export ready", "Export blocked"]) {
    const manual = await request(
      `${root}/manual-expenses`,
      "POST",
      owner,
      {
        merchant,
        date: "2026-11-05",
        totalMinor: 1220,
        currency: "UYU",
        categoryName: "Food",
        lines: [
          {
            description: "Synthetic item",
            quantityMilli: 1000,
            totalMinor: 1220,
          },
        ],
      },
      randomUUID(),
    );
    status(manual.status, 201, "manual");
    const origin = manual.data.expense.id;
    if (merchant === "Export ready") {
      const review = await request(
        `${root}/review/manual/${origin}`,
        "GET",
        owner,
      );
      status(review.status, 200, "review");
      const current = review.data.review.current;
      const correction = await request(
        `${root}/review/manual/${origin}`,
        "PATCH",
        owner,
        {
          expectedVersion: 0,
          expectedBaseProposalId: null,
          reason: "Synthetic export completion",
          fields: {
            ...current,
            subtotalMinor: 1000,
            taxMinor: 220,
            taxUnknown: false,
            paymentMethod: "cash",
          },
        },
        randomUUID(),
      );
      status(correction.status, 200, "correction");
    }
    const approval = await request(
      `${root}/review/manual/${origin}/lifecycle`,
      "POST",
      owner,
      {
        action: "approve",
        expectedVersion: merchant === "Export ready" ? 1 : 0,
        expectedBaseProposalId: null,
      },
      randomUUID(),
    );
    status(approval.status, 200, "approval");
    ids.push(approval.data.review.approvedPurchaseId);
  }
  const path = `${root}/exports`;
  const body = { purchaseIds: ids, mode: "full" };
  status(
    (await request(`${path}/preview`, "POST", viewer, body)).status,
    403,
    "viewer preview",
  );
  status(
    (await request(`${path}/preview`, "POST", outsider, body)).status,
    404,
    "outsider preview",
  );
  const preview = await request(`${path}/preview`, "POST", editor, body);
  status(preview.status, 200, "preview");
  if (preview.data.ready.length !== 1 || preview.data.blocked.length !== 1)
    throw new Error("Partial preview did not separate records");
  const key = randomUUID();
  const created = await request(path, "POST", editor, body, key);
  status(created.status, 200, "create");
  if (
    created.data.exportedIds.length !== 1 ||
    created.data.blocked.length !== 1
  )
    throw new Error("Partial export did not separate records");
  const repeat = await request(path, "POST", editor, body, key);
  status(repeat.status, 200, "retry");
  if (repeat.data.exportId !== created.data.exportId || !repeat.data.repeated)
    throw new Error("Retry created another batch");
  status(
    (
      await request(
        path,
        "POST",
        editor,
        { purchaseIds: [ids[0]], mode: "full" },
        key,
      )
    ).status,
    409,
    "conflicting retry",
  );
  const download = await request(
    `${path}/${created.data.exportId}`,
    "GET",
    owner,
  );
  status(download.status, 200, "download");
  const files = unzipSync(download.bytes!);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    manifest.recordCount !== 1 ||
    !files["purchases.json"] ||
    !files["receipts.csv"] ||
    !files["lines.csv"]
  )
    throw new Error("ZIP contract incomplete");
  status(
    (await request(`${path}/${created.data.exportId}`, "GET", viewer)).status,
    403,
    "viewer download",
  );
  const history = await request(path, "GET", editor);
  status(history.status, 200, "history");
  if (history.data.history.length !== 1)
    throw new Error("History missing batch");
  status(
    (
      await request(
        `${root}/approved-records/${ids[0]}`,
        "POST",
        owner,
        { action: "archive", expectedArchived: false },
        randomUUID(),
      )
    ).status,
    200,
    "archive",
  );
  const archived = await request(`${path}/preview`, "POST", owner, {
    purchaseIds: [ids[0]],
    mode: "full",
  });
  if (!archived.data.blocked[0].reasons.includes("ARCHIVED"))
    throw new Error("Archived export allowed");
  status(
    (
      await request(
        `${root}/approved-records/${ids[0]}`,
        "POST",
        owner,
        { action: "restore", expectedArchived: true },
        randomUUID(),
      )
    ).status,
    200,
    "restore",
  );
  const before = await request(
    `${root}/approved-records/${ids[0]}`,
    "GET",
    owner,
  );
  const origin = before.data.record.originId;
  const review = await request(`${root}/review/manual/${origin}`, "GET", owner);
  const revised = await request(
    `${root}/review/manual/${origin}`,
    "PATCH",
    owner,
    {
      expectedVersion: review.data.review.version,
      expectedBaseProposalId: null,
      reason: "Synthetic approved correction",
      fields: {
        ...review.data.review.current,
        paymentMethod: "debit card",
      },
    },
    randomUUID(),
  );
  status(revised.status, 200, "approved correction");
  const correctionBody = { purchaseIds: [ids[0]], mode: "correction" };
  const correctionPreview = await request(
    `${path}/preview`,
    "POST",
    editor,
    correctionBody,
  );
  status(correctionPreview.status, 200, "correction preview");
  if (
    correctionPreview.data.ready[0]?.supersedesBatchId !== created.data.exportId
  )
    throw new Error("Correction did not supersede prior batch");
  const second = await request(
    path,
    "POST",
    editor,
    correctionBody,
    randomUUID(),
  );
  status(second.status, 200, "correction export");
  const secondHistory = await request(path, "GET", editor);
  if (
    secondHistory.data.history.length !== 2 ||
    secondHistory.data.history[0].records[0].supersedesBatchId !==
      created.data.exportId
  )
    throw new Error("Correction history was not preserved");
  console.log("Synthetic export smoke passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
