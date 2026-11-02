"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { pesosDisplay } from "@/app/money";
import type { ReviewFields } from "@/server/review/fields";

type RecordDetail = {
  id: string;
  origin: "receipt" | "manual";
  originId: string;
  fields: ReviewFields;
  reviewVersion: number;
  approvedAt: string;
  archivedAt: string | null;
  approvalMode: string;
  role: "owner" | "editor" | "viewer";
  sources: { id: string; filename: string; removedAt: string | null }[];
  allocations: {
    categoryName: string;
    amountMinor: number;
    lineIndexes: number[];
    kind: string;
    stale: boolean;
  }[];
  products: { lineIndex: number; productName: string; brand: string | null }[];
};
export default function ApprovedDetailPage() {
  const { workspaceId, purchaseId } = useParams<{
    workspaceId: string;
    purchaseId: string;
  }>();
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/approved-records/${purchaseId}`,
      { cache: "no-store" },
    );
    if (response.ok) setRecord((await response.json()).record);
    else setMessage("No se encontró la compra aprobada.");
  }, [workspaceId, purchaseId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function archive() {
    if (!record) return;
    const response = await fetch(
      `/api/workspaces/${workspaceId}/approved-records/${purchaseId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: record.archivedAt ? "restore" : "archive",
          expectedArchived: Boolean(record.archivedAt),
        }),
      },
    );
    if (response.ok) {
      setMessage("Estado actualizado.");
      await load();
    } else
      setMessage(
        (await response.json()).error?.message ?? "No se pudo actualizar.",
      );
  }
  if (!record)
    return (
      <main>
        <p>{message || "Cargando…"}</p>
        <Link href={`/workspaces/${workspaceId}/approved`}>Volver</Link>
      </main>
    );
  const f = record.fields;
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/approved`}>
          Volver a compras aprobadas
        </Link>
      </p>
      <h1>{f.merchant}</h1>
      {message && <p role="status">{message}</p>}
      <p>
        {record.origin === "receipt" ? "Recibo" : "Gasto manual"} · Aprobada{" "}
        {new Date(record.approvedAt).toLocaleString("es-UY")} ·{" "}
        {record.approvalMode === "auto" ? "automática" : "manual"}
      </p>
      <p>
        ID de compra: {record.id} · ID de origen: {record.originId}
      </p>
      {record.archivedAt && (
        <p>
          Archivada el {new Date(record.archivedAt).toLocaleString("es-UY")}
        </p>
      )}
      <dl>
        <dt>Fecha</dt>
        <dd>{f.date ?? "Sin fecha"}</dd>
        <dt>Total</dt>
        <dd>
          {f.totalMinor === null ? "Sin total" : pesosDisplay(f.totalMinor)}{" "}
          {f.currency ?? ""}
        </dd>
        <dt>Categoría original</dt>
        <dd>{f.categoryName ?? "Sin categoría"}</dd>
        <dt>Subtotal</dt>
        <dd>
          {f.subtotalMinor === null
            ? "Sin dato"
            : pesosDisplay(f.subtotalMinor)}
        </dd>
        <dt>IVA del recibo</dt>
        <dd>
          {f.taxUnknown
            ? "Desconocido"
            : f.taxMinor === null
              ? "Sin dato"
              : pesosDisplay(f.taxMinor)}
        </dd>
        <dt>Pago</dt>
        <dd>{f.paymentMethod ?? "Sin dato"}</dd>
      </dl>
      <section>
        <h2>Ítems</h2>
        <ol>
          {f.lineItems.map((line, index) => (
            <li key={index}>
              {line.description} ·{" "}
              {line.lineTotalMinor === null
                ? "Sin total"
                : pesosDisplay(line.lineTotalMinor)}
              {line.taxMinor != null &&
                ` · IVA explícito ${pesosDisplay(line.taxMinor)}`}
              {record.products.find((item) => item.lineIndex === index) &&
                ` · Producto: ${record.products.find((item) => item.lineIndex === index)!.productName}`}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Distribución</h2>
        {record.allocations.some((item) => item.stale) && (
          <p role="alert">
            La distribución requiere revisión tras una corrección.
          </p>
        )}
        <ul>
          {record.allocations.map((item, index) => (
            <li key={index}>
              {item.categoryName}: {pesosDisplay(item.amountMinor)}{" "}
              {item.kind === "remainder" ? "(restante)" : ""}
            </li>
          ))}
        </ul>
      </section>
      {record.sources.length > 0 && (
        <section>
          <h2>Fuentes</h2>
          <ul>
            {record.sources.map((source) => (
              <li key={source.id}>
                {source.removedAt ? (
                  `${source.filename} (archivo retirado)`
                ) : (
                  <a
                    href={`/api/workspaces/${workspaceId}/sources/${source.id}`}
                  >
                    {source.filename}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>
        <Link
          href={
            record.origin === "receipt"
              ? `/workspaces/${workspaceId}/receipts/${record.originId}/review`
              : `/workspaces/${workspaceId}/manual-expenses/${record.originId}`
          }
        >
          Ver revisión e historial
        </Link>
      </p>
      {record.role !== "viewer" && (
        <p>
          <Link
            href={`/workspaces/${workspaceId}/products?purchaseId=${record.id}`}
          >
            Vincular productos
          </Link>{" "}
          ·{" "}
          <Link
            href={`/workspaces/${workspaceId}/allocations?purchaseId=${record.id}`}
          >
            Editar distribución
          </Link>
        </p>
      )}
      {record.role === "owner" && (
        <button type="button" onClick={() => void archive()}>
          {record.archivedAt ? "Restaurar compra" : "Archivar compra"}
        </button>
      )}
    </main>
  );
}
