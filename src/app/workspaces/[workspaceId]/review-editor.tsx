"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewFields } from "@/server/review/fields";
import type {
  ReviewOrigin,
  ReviewRecord,
} from "@/server/review/review-service";

const labels: Record<keyof ReviewFields, string> = {
  merchant: "Comercio",
  date: "Fecha",
  totalMinor: "Total (centésimos)",
  currency: "Moneda",
  subtotalMinor: "Subtotal (centésimos)",
  taxMinor: "IVA (centésimos)",
  taxUnknown: "IVA desconocido",
  paymentMethod: "Medio de pago",
  categoryName: "Categoría provisional",
  lineItems: "Ítems",
};
const moneyKeys = ["totalMinor", "subtotalMinor", "taxMinor"] as const;
const textKeys = ["merchant", "date", "paymentMethod", "categoryName"] as const;

export function ReviewEditor({
  workspaceId,
  origin,
  originId,
}: {
  workspaceId: string;
  origin: ReviewOrigin;
  originId: string;
}) {
  const path = `/api/workspaces/${workspaceId}/review/${origin}/${originId}`;
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [draft, setDraft] = useState<ReviewFields | null>(null);
  const [editable, setEditable] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  function updateLine(
    index: number,
    patch: Partial<ReviewFields["lineItems"][number]>,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      lineItems: draft.lineItems.map((row, n) =>
        n === index ? { ...row, ...patch } : row,
      ),
    });
  }
  const load = useCallback(async () => {
    const [reviewResponse, workspaceResponse] = await Promise.all([
      fetch(path, { cache: "no-store" }),
      fetch("/api/workspaces", { cache: "no-store" }),
    ]);
    if (!reviewResponse.ok || !workspaceResponse.ok) {
      setMessage("No se pudo cargar la revisión.");
      return;
    }
    const data = (await reviewResponse.json()) as { review: ReviewRecord };
    const workspaces = (await workspaceResponse.json()) as {
      workspaces: { id: string; role: string }[];
    };
    setReview(data.review);
    setDraft(data.review.current);
    setEditable(
      workspaces.workspaces.some(
        (w) => w.id === workspaceId && w.role !== "viewer",
      ),
    );
  }, [path, workspaceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save() {
    if (!review || !draft) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: review.version,
          expectedBaseProposalId: review.baseProposalId,
          reason,
          fields: draft,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { code?: string } };
        if (body.error?.code === "REVIEW_VERSION_CONFLICT") {
          await load();
          setMessage(
            "Otra persona cambió esta revisión. Se cargó la versión actual.",
          );
        } else setMessage("No se pudo guardar. Revisá los campos y el motivo.");
        return;
      }
      const body = (await response.json()) as { review: ReviewRecord };
      setReview(body.review);
      setDraft(body.review.current);
      setReason("");
      setMessage("Corrección guardada.");
    } catch {
      setMessage("No se pudo guardar la corrección.");
    } finally {
      setSaving(false);
    }
  }
  if (!review || !draft)
    return (
      <section className="workspace-card">
        <h2>Correcciones</h2>
        <p>{message || "Cargando…"}</p>
      </section>
    );
  return (
    <section className="workspace-card">
      <h2>Correcciones</h2>
      <p>
        Versión {review.version}. Los valores originales y cada cambio quedan
        disponibles en el historial.
      </p>
      <div className="review-editor-fields">
        {textKeys.map((key) => (
          <label key={key}>
            {labels[key]}
            <input
              type={key === "date" ? "date" : "text"}
              value={draft[key] ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                setDraft({ ...draft, [key]: event.target.value || null })
              }
            />
          </label>
        ))}
        {moneyKeys.map((key) => (
          <label key={key}>
            {labels[key]}
            <input
              type="number"
              min="0"
              step="1"
              value={draft[key] ?? ""}
              disabled={
                !editable || saving || (key === "taxMinor" && draft.taxUnknown)
              }
              onChange={(event) =>
                setDraft({
                  ...draft,
                  [key]:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
        ))}
        <label>
          Moneda
          <select
            value={draft.currency ?? ""}
            disabled={!editable || saving}
            onChange={(event) =>
              setDraft({
                ...draft,
                currency: event.target.value
                  ? (event.target.value as "UYU" | "USD")
                  : null,
              })
            }
          >
            <option value="">Sin dato</option>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.taxUnknown}
            disabled={!editable || saving}
            onChange={(event) =>
              setDraft({
                ...draft,
                taxUnknown: event.target.checked,
                taxMinor: event.target.checked ? null : draft.taxMinor,
              })
            }
          />{" "}
          IVA desconocido
        </label>
      </div>
      <h3>Ítems normalizados</h3>
      {draft.lineItems.map((item, index) => (
        <div className="review-line" key={index}>
          <label>
            Descripción
            <input
              value={item.description}
              disabled={!editable || saving}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  lineItems: draft.lineItems.map((row, n) =>
                    n === index
                      ? { ...row, description: event.target.value }
                      : row,
                  ),
                })
              }
            />
          </label>
          <label>
            Cantidad
            <input
              value={item.quantity ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  lineItems: draft.lineItems.map((row, n) =>
                    n === index
                      ? { ...row, quantity: event.target.value || null }
                      : row,
                  ),
                })
              }
            />
          </label>
          <label>
            Unidad
            <input
              value={item.unit ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                updateLine(index, { unit: event.target.value || null })
              }
            />
          </label>
          <label>
            Precio unitario (centésimos)
            <input
              type="number"
              min="0"
              step="1"
              value={item.unitPriceMinor ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                updateLine(index, {
                  unitPriceMinor:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Descuento (centésimos)
            <input
              type="number"
              min="0"
              step="1"
              value={item.discountMinor ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                updateLine(index, {
                  discountMinor:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Total (centésimos)
            <input
              type="number"
              min="0"
              step="1"
              value={item.lineTotalMinor ?? ""}
              disabled={!editable || saving}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  lineItems: draft.lineItems.map((row, n) =>
                    n === index
                      ? {
                          ...row,
                          lineTotalMinor:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        }
                      : row,
                  ),
                })
              }
            />
          </label>
          {editable && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                setDraft({
                  ...draft,
                  lineItems: draft.lineItems.filter((_, n) => n !== index),
                })
              }
            >
              Quitar ítem
            </button>
          )}
        </div>
      ))}
      {editable && (
        <>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              setDraft({
                ...draft,
                lineItems: [
                  ...draft.lineItems,
                  {
                    description: "",
                    quantity: null,
                    unit: null,
                    unitPriceMinor: null,
                    discountMinor: null,
                    lineTotalMinor: null,
                  },
                ],
              })
            }
          >
            Agregar ítem
          </button>
          <label>
            Motivo del cambio
            <textarea
              value={reason}
              disabled={saving}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={saving || reason.trim().length < 3}
            onClick={() => void save()}
          >
            Guardar corrección
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Historial inmutable</h3>
      {review.revisions.length === 0 ? (
        <p>Sin correcciones.</p>
      ) : (
        <ol>
          {review.revisions.map((revision) => (
            <li key={revision.version}>
              <p>
                Versión {revision.version} · {revision.createdAt} · Autor{" "}
                {revision.actorUserId} · Motivo: {revision.reason}
              </p>
              <dl>
                {(Object.keys(labels) as (keyof ReviewFields)[])
                  .filter(
                    (key) =>
                      JSON.stringify(revision.before[key]) !==
                      JSON.stringify(revision.after[key]),
                  )
                  .map((key) => (
                    <div key={key}>
                      <dt>{labels[key]}</dt>
                      <dd>
                        {JSON.stringify(revision.before[key])} →{" "}
                        {JSON.stringify(revision.after[key])}
                      </dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
