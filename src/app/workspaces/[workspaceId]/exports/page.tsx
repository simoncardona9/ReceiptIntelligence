"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ApprovedSummary } from "@/server/records/approved-record-service";

type Preview = {
  ready: {
    purchaseId: string;
    reviewVersion: number;
    supersedesBatchId: string | null;
  }[];
  blocked: { purchaseId: string; reasons: string[] }[];
};
type History = {
  id: string;
  mode: string;
  createdAt: string;
  manifest: {
    recordCount: number;
    currencyTotalsMinor: { UYU: number; USD: number };
  };
};

export default function ExportsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [records, setRecords] = useState<ApprovedSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"full" | "correction">("full");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [message, setMessage] = useState("");
  const base = `/api/workspaces/${workspaceId}/exports`;
  const load = useCallback(async () => {
    const [recordsResponse, historyResponse] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/approved-records`, {
        cache: "no-store",
      }),
      fetch(base, { cache: "no-store" }),
    ]);
    if (recordsResponse.ok)
      setRecords(
        (await recordsResponse.json()).records.filter(
          (record: ApprovedSummary) => !record.archivedAt,
        ),
      );
    if (historyResponse.ok) setHistory((await historyResponse.json()).history);
    else setMessage("No se pudo cargar el historial de exportación.");
  }, [workspaceId, base]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function submit(action: "preview" | "create") {
    setMessage("");
    if (!selected.length) {
      setMessage("Selecciona al menos una compra.");
      return;
    }
    const response = await fetch(
      action === "preview" ? `${base}/preview` : base,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(action === "create"
            ? { "Idempotency-Key": crypto.randomUUID() }
            : {}),
        },
        body: JSON.stringify({ purchaseIds: selected, mode }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error?.message ?? "La exportación falló.");
      return;
    }
    if (action === "preview") setPreview(result);
    else {
      setMessage(
        `Exportación creada: ${result.exportedIds?.length ?? "repetida"} compra(s).`,
      );
      setPreview(null);
      await load();
      const download = document.createElement("a");
      download.href = `${base}/${result.exportId}`;
      download.download = `receipt-export-${result.exportId}.zip`;
      download.click();
    }
  }
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/approved`}>
          Volver a compras aprobadas
        </Link>
      </p>
      <h1>Centro de exportación</h1>
      <p>
        Selecciona compras aprobadas y revisa cuáles se pueden exportar. Las
        archivadas no aparecen.
      </p>
      {message && <p role="alert">{message}</p>}
      <fieldset>
        <legend>Compras</legend>
        {records.map((record) => (
          <label key={record.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={selected.includes(record.id)}
              onChange={(event) => {
                setPreview(null);
                setSelected(
                  event.target.checked
                    ? [...selected, record.id]
                    : selected.filter((id) => id !== record.id),
                );
              }}
            />{" "}
            {record.merchant ?? "Sin comercio"} · {record.originId} ·{" "}
            {record.currency ?? "?"}
          </label>
        ))}
        {!records.length && <p>No hay compras aprobadas activas.</p>}
      </fieldset>
      <label>
        Tipo de reexportación{" "}
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as "full" | "correction");
            setPreview(null);
          }}
        >
          <option value="full">Completa</option>
          <option value="correction">Solo correcciones</option>
        </select>
      </label>
      <p>
        <button onClick={() => void submit("preview")}>Vista previa</button>{" "}
        <button
          disabled={!preview?.ready.length}
          onClick={() => void submit("create")}
        >
          Crear ZIP
        </button>
      </p>
      {preview && (
        <section>
          <h2>Vista previa</h2>
          <p>
            {preview.ready.length} listas · {preview.blocked.length} bloqueadas
          </p>
          {preview.ready.map((item) => (
            <p key={item.purchaseId}>
              {item.purchaseId} · revisión {item.reviewVersion}
              {item.supersedesBatchId &&
                ` · reemplaza ${item.supersedesBatchId}`}
            </p>
          ))}
          {preview.blocked.map((item) => (
            <p key={item.purchaseId}>
              {item.purchaseId}: {item.reasons.join(", ")}
            </p>
          ))}
        </section>
      )}
      <section>
        <h2>Historial</h2>
        {history.map((item) => (
          <p key={item.id}>
            {new Date(item.createdAt).toLocaleString("es-UY")} · {item.mode} ·{" "}
            {item.manifest.recordCount} compras · UYU{" "}
            {item.manifest.currencyTotalsMinor.UYU} / USD{" "}
            {item.manifest.currencyTotalsMinor.USD} ·{" "}
            <a href={`${base}/${item.id}`}>Descargar ZIP</a>
          </p>
        ))}
      </section>
    </main>
  );
}
