"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Job = {
  id: string;
  receiptId: string;
  status: string;
  attempts: number;
  priority: number;
  safeErrorCode: string | null;
  nextAttemptAt: string;
};
type Queue = {
  paused: boolean;
  resourcePaused: boolean;
  role: "owner" | "editor" | "viewer";
  jobs: Job[];
};

const labels: Record<string, string> = {
  queued: "En cola",
  running: "Procesando",
  retry_wait: "Reintento programado",
  failed: "Falló",
  completed: "Extracción completa",
  cancelled: "Cancelado",
  stopped: "Detenido",
};

export default function ExtractionPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const prior = useRef<Map<string, string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/extraction-jobs`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { queue: Queue };
      const next = new Map(body.queue.jobs.map((job) => [job.id, job.status]));
      if (
        prior.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        for (const job of body.queue.jobs) {
          if (
            prior.current.get(job.id) !== job.status &&
            ["completed", "failed"].includes(job.status)
          )
            new Notification("Extracción de recibo", {
              body: labels[job.status],
            });
        }
      }
      prior.current = next;
      setQueue(body.queue);
      setError("");
    } catch {
      setError("No se pudo cargar la cola.");
    }
  }, [workspaceId, router]);

  useEffect(() => {
    const start = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function action(path: string, body?: object) {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) throw new Error();
      await refresh();
    } catch {
      setError("No se pudo cambiar el estado de la cola.");
    }
  }

  return (
    <main>
      <Link href={`/workspaces/${workspaceId}/inbox`}>← Bandeja</Link>
      <h1>Cola de extracción</h1>
      <p>
        Los recibos se procesan localmente, uno por vez. Se muestran hasta 100
        trabajos recientes.
      </p>
      {queue?.resourcePaused && (
        <p role="alert" className="error">
          La cola se pausó por falta de recursos. El propietario debe revisar y
          reanudar.
        </p>
      )}
      {queue?.paused && !queue.resourcePaused && <p>La cola está pausada.</p>}
      {queue?.role === "owner" && (
        <div className="actions">
          <button
            type="button"
            onClick={() =>
              void action(
                `extraction-queue/${queue.paused ? "resume" : "pause"}`,
              )
            }
          >
            {queue.paused ? "Reanudar cola" : "Pausar cola"}
          </button>
        </div>
      )}
      {typeof Notification !== "undefined" &&
        Notification.permission === "default" && (
          <button
            type="button"
            onClick={() => void Notification.requestPermission()}
          >
            Activar avisos del navegador
          </button>
        )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {queue?.jobs.length === 0 && <p>No hay trabajos todavía.</p>}
      <div className="workspace-list">
        {queue?.jobs.map((job) => (
          <article className="workspace-card" key={job.id}>
            <h2>
              <Link
                href={`/workspaces/${workspaceId}/receipts/${job.receiptId}/review`}
              >
                Recibo {job.receiptId}
              </Link>
            </h2>
            <p>
              {labels[job.status] ?? job.status} · Intento {job.attempts} de 5 ·
              Prioridad {job.priority}
            </p>
            {job.status === "retry_wait" && (
              <p>
                Próximo intento:{" "}
                {new Date(job.nextAttemptAt).toLocaleString("es-UY")}
              </p>
            )}
            {queue.role === "owner" && job.safeErrorCode && (
              <p>Código: {job.safeErrorCode}</p>
            )}
            {queue.role !== "viewer" && (
              <div className="actions">
                {["failed", "stopped"].includes(job.status) && (
                  <button
                    type="button"
                    onClick={() =>
                      void action(`extraction-jobs/${job.id}/retry`)
                    }
                  >
                    Reintentar
                  </button>
                )}
                {["queued", "retry_wait"].includes(job.status) &&
                  job.priority < 10 && (
                    <button
                      type="button"
                      onClick={() =>
                        void action(`extraction-jobs/${job.id}/priority`, {
                          priority: job.priority + 1,
                        })
                      }
                    >
                      Subir prioridad
                    </button>
                  )}
                {queue.role === "owner" &&
                  ["queued", "running", "retry_wait"].includes(job.status) && (
                    <button
                      type="button"
                      onClick={() =>
                        void action(`extraction-jobs/${job.id}/cancel`)
                      }
                    >
                      Cancelar
                    </button>
                  )}
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
