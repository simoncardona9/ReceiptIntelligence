"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewFields } from "@/server/review/fields";
import type {
  ReviewOrigin,
  ReviewRecord,
} from "@/server/review/review-service";
import type { MandatoryField } from "@/server/review/validation";

const warningLabels: Record<string, string> = {
  MISSING_MERCHANT: "Falta comercio",
  MISSING_TOTAL: "Falta total",
  MISSING_CATEGORY: "Falta categoría",
  CONFLICT_MERCHANT: "Comercio en conflicto",
  CONFLICT_TOTALMINOR: "Total en conflicto",
  LOW_CONFIDENCE_MERCHANT: "Comercio con confianza baja",
  LOW_CONFIDENCE_TOTALMINOR: "Total con confianza baja",
  TAX_STATUS_CONFLICT: "IVA marcado como desconocido y con valor",
  AMOUNT_MISMATCH: "Subtotal menos descuento más IVA no coincide con total",
  TAX_UNKNOWN: "IVA desconocido",
  ARITHMETIC_INCOMPLETE: "No hay datos suficientes para conciliar",
  MISSING_EXPORT_DATE: "Falta fecha para exportar",
  MISSING_EXPORT_CURRENCY: "Falta moneda para exportar",
  MISSING_EXPORT_PAYMENT_METHOD: "Falta medio de pago para exportar",
  UNSPLIT_EXPENSE: "Gasto sin ítems detallados",
  LINE_ITEMS_INCOMPLETE: "Ítems incompletos",
};

const labels: Record<keyof ReviewFields, string> = {
  merchant: "Comercio",
  date: "Fecha",
  totalMinor: "Total (centésimos)",
  currency: "Moneda",
  subtotalMinor: "Subtotal (centésimos)",
  discountMinor: "Descuento (centésimos)",
  taxMinor: "IVA (centésimos)",
  taxUnknown: "IVA desconocido",
  paymentMethod: "Medio de pago",
  categoryName: "Categoría provisional",
  lineItems: "Ítems",
};
const moneyKeys = [
  "totalMinor",
  "subtotalMinor",
  "discountMinor",
  "taxMinor",
] as const;
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
  const [confirmFields, setConfirmFields] = useState<MandatoryField[]>([]);
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
          confirmFields,
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
      setConfirmFields([]);
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
      <h3>Validación</h3>
      <p role="status">
        {review.validation.state === "blocked"
          ? "Aprobación bloqueada"
          : "Lista para aprobar"}
      </p>
      <ul>
        {review.validation.warnings.map((warning) => (
          <li key={warning.code}>
            {warningLabels[warning.code] ?? warning.code} ·{" "}
            {warning.severity === "financial" ? "Financiera" : "Informativa"}
            {warning.blocksApproval ? " · Bloquea aprobación" : ""}
            {warning.blocksExport ? " · Bloquea exportación" : ""}
          </li>
        ))}
      </ul>
      {editable &&
        review.validation.warnings.some(
          (warning) =>
            warning.code.startsWith("CONFLICT_") ||
            warning.code.startsWith("LOW_CONFIDENCE_"),
        ) && (
          <fieldset>
            <legend>Confirmar valores detectados</legend>
            {(["merchant", "totalMinor"] as MandatoryField[]).map((field) => (
              <label key={field}>
                <input
                  type="checkbox"
                  disabled={review.confirmedFields.includes(field) || saving}
                  checked={
                    review.confirmedFields.includes(field) ||
                    confirmFields.includes(field)
                  }
                  onChange={(event) =>
                    setConfirmFields(
                      event.target.checked
                        ? [...confirmFields, field]
                        : confirmFields.filter((value) => value !== field),
                    )
                  }
                />{" "}
                Confirmo {field === "merchant" ? "comercio" : "total"} con el
                valor mostrado
              </label>
            ))}
          </fieldset>
        )}
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
              {revision.afterConfirmedFields.filter(
                (field) => !revision.beforeConfirmedFields.includes(field),
              ).length > 0 && (
                <p>
                  Confirmado:{" "}
                  {revision.afterConfirmedFields
                    .filter(
                      (field) =>
                        !revision.beforeConfirmedFields.includes(field),
                    )
                    .join(", ")}
                </p>
              )}
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
