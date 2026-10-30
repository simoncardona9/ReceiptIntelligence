"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewFields } from "@/server/review/fields";
import type {
  LifecycleAction,
  ReviewOrigin,
  ReviewRecord,
} from "@/server/review/review-service";
import type { MandatoryField } from "@/server/review/validation";
import { MoneyInput } from "@/app/money-input";
import { pesosDisplay } from "@/app/money";

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
  totalMinor: "Total",
  currency: "Moneda",
  subtotalMinor: "Subtotal",
  discountMinor: "Descuento",
  taxMinor: "IVA",
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
const moneyLabel = (label: string, currency: ReviewFields["currency"]) =>
  `${label} (${currency === "UYU" ? "pesos UYU" : currency === "USD" ? "dólares USD" : "moneda sin definir"})`;

function revisionValue(
  key: keyof ReviewFields,
  value: ReviewFields[keyof ReviewFields],
): string {
  if (value === null) return "Sin dato";
  if (
    moneyKeys.some((moneyKey) => moneyKey === key) &&
    typeof value === "number"
  )
    return pesosDisplay(value);
  if (key === "lineItems" && Array.isArray(value))
    return value.length === 0
      ? "Sin ítems"
      : value
          .map((item, index) =>
            [
              `${index + 1}. ${item.description}`,
              item.quantity ? `cantidad ${item.quantity}` : null,
              item.unit ? `unidad ${item.unit}` : null,
              item.unitPriceMinor === null
                ? null
                : `precio ${pesosDisplay(item.unitPriceMinor)}`,
              item.discountMinor === null
                ? null
                : `descuento ${pesosDisplay(item.discountMinor)}`,
              item.lineTotalMinor === null
                ? null
                : `total ${pesosDisplay(item.lineTotalMinor)}`,
            ]
              .filter(Boolean)
              .join(" · "),
          )
          .join("; ");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

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
  const [role, setRole] = useState("viewer");
  const [reason, setReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmFields, setConfirmFields] = useState<MandatoryField[]>([]);
  const [invalidMoney, setInvalidMoney] = useState<Set<string>>(new Set());
  const [lineIds, setLineIds] = useState<string[]>([]);
  function markMoneyInvalid(key: string, invalid: boolean) {
    setInvalidMoney((current) => {
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  }
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
  function removeLine(index: number) {
    if (!draft) return;
    const id = lineIds[index];
    setDraft({
      ...draft,
      lineItems: draft.lineItems.filter((_, at) => at !== index),
    });
    setLineIds((current) => current.filter((_, at) => at !== index));
    if (id)
      setInvalidMoney(
        (current) =>
          new Set([...current].filter((key) => !key.startsWith(`line:${id}:`))),
      );
  }
  function addLine() {
    if (!draft) return;
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
    });
    setLineIds((current) => [...current, crypto.randomUUID()]);
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
    setLineIds(data.review.current.lineItems.map(() => crypto.randomUUID()));
    setInvalidMoney(new Set());
    setRole(
      workspaces.workspaces.find((w) => w.id === workspaceId)?.role ?? "viewer",
    );
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
    if (!review || !draft || invalidMoney.size > 0) return;
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
      setLineIds(body.review.current.lineItems.map(() => crypto.randomUUID()));
      setInvalidMoney(new Set());
      setReason("");
      setConfirmFields([]);
      setMessage("Corrección guardada.");
    } catch {
      setMessage("No se pudo guardar la corrección.");
    } finally {
      setSaving(false);
    }
  }
  async function decide(decision: LifecycleAction) {
    if (!review) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${path}/lifecycle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: review.version,
          expectedBaseProposalId: review.baseProposalId,
          ...decision,
        }),
      });
      const body = (await response.json()) as {
        review?: ReviewRecord;
        error?: { code?: string };
      };
      if (!response.ok || !body.review) {
        if (
          body.error?.code === "REVIEW_VERSION_CONFLICT" ||
          body.error?.code === "REVIEW_SOURCE_CHANGED"
        ) {
          await load();
          setMessage("La revisión cambió. Se cargó la versión actual.");
        } else
          setMessage(
            body.error?.code === "APPROVAL_BLOCKED"
              ? "Hay bloqueos financieros que deben resolverse."
              : "No se pudo completar la decisión.",
          );
        return;
      }
      setReview(body.review);
      setDraft(body.review.current);
      setLineIds(body.review.current.lineItems.map(() => crypto.randomUUID()));
      setInvalidMoney(new Set());
      setRejectionReason("");
      setMessage(
        decision.action === "reject"
          ? "Rechazo permanente registrado."
          : body.review.status === "approved"
            ? "Compra aprobada."
            : "Preferencia de aprobación automática guardada.",
      );
    } catch {
      setMessage("No se pudo completar la decisión.");
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
  const canEdit = editable && review.status !== "rejected";
  const hasUnsaved =
    JSON.stringify(draft) !== JSON.stringify(review.current) ||
    confirmFields.length > 0 ||
    invalidMoney.size > 0;
  return (
    <section className="workspace-card review-editor">
      <h2>Correcciones</h2>
      <p>
        Versión {review.version}. Los valores originales y cada cambio quedan
        disponibles en el historial.
      </p>
      <h3>Validación</h3>
      <p role="status">
        {review.status === "approved"
          ? "Compra aprobada"
          : review.status === "rejected"
            ? "Rechazo permanente"
            : review.status === "blocked"
              ? "Aprobación bloqueada"
              : "Lista para aprobar"}
      </p>
      {review.approvedPurchaseId && (
        <p>Compra aprobada: {review.approvedPurchaseId}</p>
      )}
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
        (review.status === "review" || review.status === "blocked") && (
          <div className="stack">
            {hasUnsaved && <p>Guardá la corrección antes de decidir.</p>}
            <div className="actions">
              <button
                type="button"
                disabled={
                  saving || hasUnsaved || review.validation.state === "blocked"
                }
                onClick={() => void decide({ action: "approve" })}
              >
                Aprobar compra
              </button>
              {role === "owner" && (
                <button
                  type="button"
                  disabled={saving || hasUnsaved}
                  onClick={() =>
                    void decide({
                      action: "auto",
                      enabled: !review.autoApprove,
                    })
                  }
                >
                  {review.autoApprove
                    ? "Desactivar aprobación automática"
                    : "Activar aprobación automática para este registro"}
                </button>
              )}
            </div>
            {review.autoApprove && (
              <p>
                La aprobación automática está seleccionada. Se aplicará cuando
                se resuelvan los bloqueos.
              </p>
            )}
            <label>
              Motivo del rechazo permanente
              <textarea
                value={rejectionReason}
                disabled={saving}
                maxLength={500}
                onChange={(event) => setRejectionReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                saving || hasUnsaved || rejectionReason.trim().length < 3
              }
              onClick={() =>
                void decide({ action: "reject", reason: rejectionReason })
              }
            >
              Rechazar permanentemente
            </button>
          </div>
        )}
      {canEdit &&
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
              disabled={!canEdit || saving}
              onChange={(event) =>
                setDraft({ ...draft, [key]: event.target.value || null })
              }
            />
          </label>
        ))}
        {moneyKeys.map((key) => (
          <label key={key}>
            {moneyLabel(labels[key], draft.currency)}
            <MoneyInput
              key={`${review.version}:${review.baseProposalId}:${key}:${key === "taxMinor" && draft.taxUnknown ? "unknown" : "known"}`}
              valueMinor={draft[key]}
              disabled={
                !canEdit || saving || (key === "taxMinor" && draft.taxUnknown)
              }
              onChangeMinor={(value) =>
                setDraft((current) =>
                  current ? { ...current, [key]: value } : current,
                )
              }
              onInvalidChange={(invalid) =>
                markMoneyInvalid(`field:${key}`, invalid)
              }
            />
          </label>
        ))}
        <label>
          Moneda
          <select
            value={draft.currency ?? ""}
            disabled={!canEdit || saving}
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
        <label className="review-checkbox">
          <input
            type="checkbox"
            checked={draft.taxUnknown}
            disabled={!canEdit || saving}
            onChange={(event) => {
              markMoneyInvalid("field:taxMinor", false);
              setDraft({
                ...draft,
                taxUnknown: event.target.checked,
                taxMinor: event.target.checked ? null : draft.taxMinor,
              });
            }}
          />{" "}
          IVA desconocido
        </label>
      </div>
      <h3>Ítems normalizados</h3>
      {draft.lineItems.map((item, index) => (
        <div className="review-line" key={lineIds[index] ?? index}>
          <label>
            Descripción
            <input
              value={item.description}
              disabled={!canEdit || saving}
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
              disabled={!canEdit || saving}
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
              disabled={!canEdit || saving}
              onChange={(event) =>
                updateLine(index, { unit: event.target.value || null })
              }
            />
          </label>
          <label>
            {moneyLabel("Precio unitario", draft.currency)}
            <MoneyInput
              key={`${review.version}:${lineIds[index]}:unitPriceMinor`}
              valueMinor={item.unitPriceMinor}
              disabled={!canEdit || saving}
              onChangeMinor={(value) =>
                updateLine(index, { unitPriceMinor: value })
              }
              onInvalidChange={(invalid) =>
                markMoneyInvalid(
                  `line:${lineIds[index]}:unitPriceMinor`,
                  invalid,
                )
              }
            />
          </label>
          <label>
            {moneyLabel("Descuento", draft.currency)}
            <MoneyInput
              key={`${review.version}:${lineIds[index]}:discountMinor`}
              valueMinor={item.discountMinor}
              disabled={!canEdit || saving}
              onChangeMinor={(value) =>
                updateLine(index, { discountMinor: value })
              }
              onInvalidChange={(invalid) =>
                markMoneyInvalid(
                  `line:${lineIds[index]}:discountMinor`,
                  invalid,
                )
              }
            />
          </label>
          <label>
            {moneyLabel("Total", draft.currency)}
            <MoneyInput
              key={`${review.version}:${lineIds[index]}:lineTotalMinor`}
              valueMinor={item.lineTotalMinor}
              disabled={!canEdit || saving}
              onChangeMinor={(value) =>
                updateLine(index, { lineTotalMinor: value })
              }
              onInvalidChange={(invalid) =>
                markMoneyInvalid(
                  `line:${lineIds[index]}:lineTotalMinor`,
                  invalid,
                )
              }
            />
          </label>
          {canEdit && (
            <button
              type="button"
              disabled={saving}
              onClick={() => removeLine(index)}
            >
              Quitar ítem
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <>
          <button type="button" disabled={saving} onClick={addLine}>
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
            disabled={
              saving || invalidMoney.size > 0 || reason.trim().length < 3
            }
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
                      <dt>
                        {moneyKeys.some((moneyKey) => moneyKey === key)
                          ? moneyLabel(labels[key], revision.after.currency)
                          : labels[key]}
                      </dt>
                      <dd>
                        {revisionValue(key, revision.before[key])} →{" "}
                        {revisionValue(key, revision.after[key])}
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
