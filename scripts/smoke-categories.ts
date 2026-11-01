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
      `${method} ${path}: HTTP ${response.status} ${raw.slice(0, 180)}`,
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
  const email = `category-${randomUUID()}@example.invalid`;
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
    { name: "Synthetic Categories" },
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
      "member approval",
    );
  }
  const path = `${root}/categories`;
  expect((await api(path, "GET", outsider)).status, 404, "outsider read");
  expect(
    (await api(path, "POST", viewer, { action: "seed" }, randomUUID())).status,
    403,
    "viewer seed",
  );
  const seedKey = randomUUID();
  const seed = await api(path, "POST", editor, { action: "seed" }, seedKey);
  expect(seed.status, 200, "seed");
  expect(
    (await api(path, "POST", editor, { action: "seed" }, seedKey)).status,
    200,
    "seed retry",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "create", name: "Different", parentId: null },
        seedKey,
      )
    ).status,
    409,
    "conflicting retry",
  );
  const list = await api(path, "GET", viewer);
  expect(list.status, 200, "viewer list");
  const categories = list.data.categories as {
    id: string;
    name: string;
    parentId: string | null;
  }[];
  if (
    categories.length !== 9 ||
    !categories.some(
      (c) =>
        c.name === "Servicios" &&
        categories.some(
          (p) => p.id === c.parentId && p.name === "Egresos fijos",
        ),
    )
  )
    throw new Error("Incorrect imported hierarchy");
  const category = await api(
    path,
    "POST",
    editor,
    { action: "create", name: "Farmacia", parentId: null },
    randomUUID(),
  );
  expect(category.status, 200, "create");
  const id = (category.data as { id: string }).id;
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "create", name: "farmácia", parentId: null },
        randomUUID(),
      )
    ).status,
    409,
    "normalized duplicate",
  );
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "map", sourceName: "Farmacia recibo", categoryId: id },
        randomUUID(),
      )
    ).status,
    200,
    "mapping",
  );
  const suggestion = await api(
    `${path}?suggest=Farmacia%20recibo`,
    "GET",
    viewer,
  );
  if (suggestion.data.mappedCategoryId !== id)
    throw new Error("Mapping was not remembered");
  expect(
    (
      await api(
        path,
        "POST",
        editor,
        { action: "archive", categoryId: id },
        randomUUID(),
      )
    ).status,
    403,
    "editor archive",
  );
  expect(
    (
      await api(
        path,
        "POST",
        owner,
        { action: "archive", categoryId: id },
        randomUUID(),
      )
    ).status,
    200,
    "owner archive",
  );
  expect(
    (
      await api(
        path,
        "POST",
        owner,
        {
          action: "archive",
          categoryId: categories.find((c) => c.name === "Egresos fijos")!.id,
        },
        randomUUID(),
      )
    ).status,
    409,
    "parent archive",
  );
  expect(
    (
      await api(
        path,
        "POST",
        outsider,
        { action: "create", name: "Secret", parentId: null },
        randomUUID(),
      )
    ).status,
    404,
    "outsider write",
  );
  console.log("Synthetic category smoke passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
