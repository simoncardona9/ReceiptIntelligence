"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Entry = {
  id: string;
  origin: "receipt" | "manual";
  status: "staged";
  createdAt: string;
  merchant: string | null;
  sourceCount: number;
};

export default function InboxPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch(`/api/workspaces/${workspaceId}/inbox`, { cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) throw new Error();
          const body = (await response.json()) as { entries: Entry[] };
          setEntries(body.entries);
        })
        .catch(() => setError("No se pudo cargar la bandeja."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, workspaceId]);
  return (
    <main>
      <Link href="/workspaces">← Espacios de trabajo</Link>
      <h1>Bandeja de recibos y gastos</h1>
      <p className="muted">
        Se muestran hasta 100 registros recientes de este espacio. Hoy solo
        existe el estado «en espera».
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {entries.length === 0 && !error && <p>No hay registros.</p>}
      <div className="workspace-list">
        {entries.map((entry) => (
          <article
            className="workspace-card"
            key={`${entry.origin}:${entry.id}`}
          >
            <h2>
              {entry.merchant ||
                (entry.origin === "receipt"
                  ? "Recibo sin comercio ingresado"
                  : "Gasto manual")}
            </h2>
            <p>
              {entry.origin === "receipt" ? "Recibo" : "Gasto manual"} · En
              espera · {new Date(entry.createdAt).toLocaleString("es-UY")}
            </p>
            <p className="muted">
              {entry.sourceCount} archivo(s) · ID: {entry.id}
            </p>
            <Link
              href={
                entry.origin === "receipt"
                  ? `/workspaces/${workspaceId}/receipts/${entry.id}/review`
                  : `/workspaces/${workspaceId}/manual-expenses/${entry.id}`
              }
            >
              Abrir
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
