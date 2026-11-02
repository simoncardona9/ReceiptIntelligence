"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { pesosDisplay } from "@/app/money";
import type { ApprovedSummary } from "@/server/records/approved-record-service";

export default function ApprovedPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [records, setRecords] = useState<ApprovedSummary[]>([]);
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [role, setRole] = useState("viewer");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [response, session] = await Promise.all([
      fetch(
        `/api/workspaces/${workspaceId}/approved-records?q=${encodeURIComponent(query)}&includeArchived=${includeArchived}`,
        { cache: "no-store" },
      ),
      fetch("/api/auth/session", { cache: "no-store" }),
    ]);
    if (response.ok) setRecords((await response.json()).records);
    else setMessage("No se pudieron cargar las compras aprobadas.");
    if (session.ok)
      setRole(
        (
          (await session.json()).workspaces as { id: string; role: string }[]
        ).find((w) => w.id === workspaceId)?.role ?? "viewer",
      );
  }, [workspaceId, query, includeArchived]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/inbox`}>
          Volver a la bandeja
        </Link>
      </p>
      <h1>Compras aprobadas</h1>
      <p>
        Busca por comercio, producto o ID de recibo. Se muestran hasta 100
        resultados.
      </p>
      {message && <p role="alert">{message}</p>}
      <label>
        Buscar{" "}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {role === "owner" && (
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />{" "}
          Incluir archivadas
        </label>
      )}
      {records.length === 0 && <p>No hay compras para esta búsqueda.</p>}
      <div className="workspace-list">
        {records.map((record) => (
          <article className="workspace-card" key={record.id}>
            <h2>{record.merchant ?? "Comercio sin nombre"}</h2>
            <p>
              {record.origin === "receipt" ? "Recibo" : "Gasto manual"} ·{" "}
              {record.totalMinor === null
                ? "Sin total"
                : pesosDisplay(record.totalMinor)}{" "}
              {record.currency ?? ""}
            </p>
            <p>
              {new Date(record.approvedAt).toLocaleString("es-UY")} · ID:{" "}
              {record.originId}
            </p>
            {record.archivedAt && (
              <p>
                Archivada el{" "}
                {new Date(record.archivedAt).toLocaleString("es-UY")}
              </p>
            )}
            <Link href={`/workspaces/${workspaceId}/approved/${record.id}`}>
              Abrir compra
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
