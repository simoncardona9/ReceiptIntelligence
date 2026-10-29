"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Workspace = {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
};
type AccessRequest = {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  status: "pending";
  requestedAt: string;
};
type SessionResponse = {
  user: { id: string; email: string };
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
};

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;
  switch (body?.error?.code) {
    case "ALREADY_A_MEMBER":
      return "Ya perteneces a ese espacio de trabajo.";
    case "OWNER_REQUIRED":
      return "Solo el propietario puede gestionar solicitudes.";
    case "WORKSPACE_NOT_FOUND":
      return "No se encontró ese espacio de trabajo.";
    case "IDEMPOTENCY_KEY_REUSED":
      return "No se pudo repetir la creación. Intenta nuevamente.";
    default:
      return "No se pudo completar la operación.";
  }
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [requests, setRequests] = useState<Record<string, AccessRequest[]>>({});
  const [workspaceName, setWorkspaceName] = useState("");
  const [requestedWorkspaceId, setRequestedWorkspaceId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) {
      setError("No se pudieron cargar tus espacios de trabajo.");
      return;
    }
    const data = (await response.json()) as SessionResponse;
    setSession(data);

    const owners = data.workspaces.filter(
      (workspace) => workspace.role === "owner",
    );
    const pending = await Promise.all(
      owners.map(async (workspace) => {
        const result = await fetch(
          `/api/workspaces/${workspace.id}/access-requests`,
          { cache: "no-store" },
        );
        if (!result.ok) return [workspace.id, []] as const;
        const body = (await result.json()) as { requests: AccessRequest[] };
        return [workspace.id, body.requests] as const;
      }),
    );
    setRequests(Object.fromEntries(pending));
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function runAction(
    action: () => Promise<Response>,
    successMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await action();
      if (!response.ok) {
        setError(await readError(response));
        return false;
      }
      setMessage(successMessage);
      await load();
      return true;
    } catch {
      setError("No se pudo conectar. Intenta nuevamente.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return runAction(
      () =>
        fetch("/api/workspaces", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ name: workspaceName }),
        }),
      "Espacio de trabajo creado.",
    ).then((succeeded) => {
      if (succeeded) setWorkspaceName("");
    });
  }

  function requestAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return runAction(
      () =>
        fetch(
          `/api/workspaces/${encodeURIComponent(requestedWorkspaceId)}/access-requests`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        ),
      "Solicitud enviada al propietario.",
    ).then((succeeded) => {
      if (succeeded) setRequestedWorkspaceId("");
    });
  }

  async function decideRequest(
    workspaceId: string,
    requestId: string,
    decision: "approve" | "decline",
    role?: "editor" | "viewer",
  ) {
    await runAction(
      () =>
        fetch(
          `/api/workspaces/${workspaceId}/access-requests/${requestId}/decision`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              decision === "approve" ? { decision, role } : { decision },
            ),
          },
        ),
      decision === "approve" ? "Acceso aprobado." : "Solicitud rechazada.",
    );
  }

  async function signOut() {
    const succeeded = await runAction(
      () => fetch("/api/auth/logout", { method: "POST" }),
      "Sesión cerrada.",
    );
    if (succeeded) router.replace("/login");
  }

  if (!session) {
    return (
      <main>
        <p>Cargando…</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Link href="/login">Volver a iniciar sesión</Link>
      </main>
    );
  }

  return (
    <main>
      <div className="workspace-heading">
        <div>
          <h1>Espacios de trabajo</h1>
          <p className="muted">Sesión: {session.user.email}</p>
        </div>
        <button disabled={busy} onClick={signOut} type="button">
          Cerrar sesión
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}

      <section aria-labelledby="your-workspaces">
        <h2 id="your-workspaces">Tus espacios</h2>
        {session.workspaces.length === 0 && (
          <p>Aún no tienes espacios. Puedes crear uno o solicitar acceso.</p>
        )}
        <div className="workspace-list">
          {session.workspaces.map((workspace) => (
            <article className="workspace-card" key={workspace.id}>
              <div className="workspace-heading">
                <div>
                  <h3>{workspace.name}</h3>
                  <p className="muted">Rol: {workspace.role}</p>
                </div>
                {session.activeWorkspaceId === workspace.id ? (
                  <strong>Seleccionado</strong>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          fetch(`/api/workspaces/${workspace.id}/select`, {
                            method: "POST",
                          }),
                        "Espacio seleccionado.",
                      )
                    }
                    type="button"
                  >
                    Seleccionar
                  </button>
                )}
              </div>
              <p className="muted">ID para solicitar acceso: {workspace.id}</p>
              {workspace.role !== "viewer" && (
                <p>
                  <Link href={`/workspaces/${workspace.id}/intake`}>
                    Cargar recibo
                  </Link>
                  {" · "}
                  <Link
                    href={`/workspaces/${workspace.id}/manual-expenses/new`}
                  >
                    Crear gasto manual
                  </Link>
                </p>
              )}

              {workspace.role === "owner" && (
                <section aria-label={`Solicitudes para ${workspace.name}`}>
                  <h3>Solicitudes pendientes</h3>
                  {(requests[workspace.id] ?? []).length === 0 ? (
                    <p className="muted">No hay solicitudes pendientes.</p>
                  ) : (
                    <div className="request-list">
                      {requests[workspace.id].map((request) => (
                        <article className="request-card" key={request.id}>
                          <p>{request.email}</p>
                          <div className="actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                void decideRequest(
                                  workspace.id,
                                  request.id,
                                  "approve",
                                  "editor",
                                )
                              }
                              type="button"
                            >
                              Aprobar como editor
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void decideRequest(
                                  workspace.id,
                                  request.id,
                                  "approve",
                                  "viewer",
                                )
                              }
                              type="button"
                            >
                              Aprobar como lector
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void decideRequest(
                                  workspace.id,
                                  request.id,
                                  "decline",
                                )
                              }
                              type="button"
                            >
                              Rechazar
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="stack">
        <section aria-labelledby="create-workspace">
          <h2 id="create-workspace">Crear un espacio</h2>
          <form onSubmit={createWorkspace}>
            <label>
              Nombre del espacio
              <input
                required
                maxLength={80}
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              Crear espacio de trabajo
            </button>
          </form>
        </section>

        <section aria-labelledby="request-access">
          <h2 id="request-access">Solicitar acceso</h2>
          <form onSubmit={requestAccess}>
            <label>
              ID del espacio de trabajo
              <input
                required
                value={requestedWorkspaceId}
                onChange={(event) =>
                  setRequestedWorkspaceId(event.target.value)
                }
              />
            </label>
            <button disabled={busy} type="submit">
              Enviar solicitud
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
