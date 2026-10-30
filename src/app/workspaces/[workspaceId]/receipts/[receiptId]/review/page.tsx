"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Proposal } from "@/server/extraction/normalization";
import type { Evidence } from "@/server/extraction/normalization";
import { PdfPage } from "./pdf-page";
import { ReviewEditor } from "../../../review-editor";

type Receipt = {
  id: string;
  status: "staged" | "processing" | "failed" | "extracted" | "review";
  sourceIds: string[];
};
const fieldLabels: Record<string, string> = {
  merchant: "Comercio",
  date: "Fecha",
  totalMinor: "Total",
  currency: "Moneda",
  subtotalMinor: "Subtotal",
  taxMinor: "IVA",
  paymentMethod: "Medio de pago",
};
const warningLabels: Record<string, string> = {
  MISSING_MERCHANT: "comercio",
  MISSING_DATE: "fecha",
  MISSING_TOTAL_MINOR: "total",
  MISSING_CURRENCY: "moneda",
  MISSING_SUBTOTAL_MINOR: "subtotal",
  MISSING_TAX_MINOR: "IVA",
  MISSING_PAYMENT_METHOD: "medio de pago",
  LINE_ITEMS_UNAVAILABLE: "ítems",
  FIELD_CONFLICT: "valores en conflicto",
};
function displayValue(name: string, value: string | number): string {
  return name.endsWith("Minor") && typeof value === "number"
    ? new Intl.NumberFormat("es-UY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100)
    : String(value);
}

export default function SourceReviewPage() {
  const { workspaceId, receiptId } = useParams<{
    workspaceId: string;
    receiptId: string;
  }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(0);
  const [error, setError] = useState("");
  const [role, setRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(
    null,
  );

  const loadReceipt = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/receipts/${receiptId}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { receipt: Receipt };
      setReceipt(body.receipt);
      const proposalResponse = await fetch(
        `/api/workspaces/${workspaceId}/receipts/${receiptId}/proposal`,
        { cache: "no-store" },
      );
      if (proposalResponse.ok) {
        const proposalBody = (await proposalResponse.json()) as {
          stored: { proposal: Proposal };
        };
        setProposal(proposalBody.stored.proposal);
      }
      const queueResponse = await fetch(
        `/api/workspaces/${workspaceId}/extraction-jobs`,
        { cache: "no-store" },
      );
      if (queueResponse.ok) {
        const queueBody = (await queueResponse.json()) as {
          queue: { role: "owner" | "editor" | "viewer" };
        };
        setRole(queueBody.queue.role);
      }
    } catch {
      setError("No se pudo abrir el recibo.");
    }
  }, [workspaceId, receiptId, router]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadReceipt(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReceipt]);

  const sourceId = receipt?.sourceIds[index];
  function showEvidence(evidence: Evidence) {
    const sourceIndex = receipt?.sourceIds.indexOf(evidence.sourceId) ?? -1;
    setSelectedEvidence(evidence);
    if (sourceIndex >= 0) setIndex(sourceIndex);
    setPage(evidence.page + 1);
  }
  async function submitExtraction() {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/receipts/${receiptId}/extraction-jobs`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      if (!response.ok) throw new Error();
      router.push(`/workspaces/${workspaceId}/extraction`);
    } catch {
      setError("No se pudo solicitar la extracción.");
    }
  }
  useEffect(() => {
    if (!sourceId) return;
    let objectUrl = "";
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch(`/api/workspaces/${workspaceId}/sources/${sourceId}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const blob = await response.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setType(blob.type);
          setUrl(objectUrl);
          setPage(
            selectedEvidence?.sourceId === sourceId
              ? selectedEvidence.page + 1
              : 1,
          );
          setPageCount(1);
          setZoom(100);
          setRotation(0);
          setCrop(0);
        })
        .catch(() => {
          if (!cancelled) setError("El archivo no está disponible.");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl("");
    };
  }, [workspaceId, sourceId, selectedEvidence]);

  return (
    <main className="review-main">
      <Link href={`/workspaces/${workspaceId}/inbox`}>← Bandeja</Link>
      <h1>Revisar fuente</h1>
      <p>
        Recibo {receiptId} · {receipt?.status ?? "Cargando…"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {receipt && (
        <>
          <div className="review-layout">
            {proposal && (
              <section className="workspace-card">
                <h2>Propuesta de extracción</h2>
                <p>
                  Estos datos requieren revisión; todavía no son un gasto
                  aprobado.
                </p>
                <dl>
                  {Object.entries(proposal.fields).map(([name, value]) => (
                    <div key={name}>
                      <dt>{fieldLabels[name]}</dt>
                      <dd>
                        {value ? (
                          <>
                            {displayValue(name, value.normalized)} · Texto:{" "}
                            {value.exact} · Confianza:{" "}
                            {value.confidence === null
                              ? "sin dato"
                              : `${Math.round(value.confidence * 100)}%`}{" "}
                            ·{" "}
                            <button
                              type="button"
                              onClick={() => showEvidence(value.evidence)}
                            >
                              Ver fuente{" "}
                              {receipt.sourceIds.indexOf(
                                value.evidence.sourceId,
                              ) + 1}
                              , página {value.evidence.page + 1}
                            </button>
                            {value.evidence.box === null &&
                              " · Región no disponible"}
                          </>
                        ) : (
                          "Sin dato"
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <h3>Ítems detectados</h3>
                {proposal.lineItems.length ? (
                  <ul>
                    {proposal.lineItems.map((item, itemIndex) => (
                      <li
                        key={`${item.description.evidence.regionId}-${itemIndex}`}
                      >
                        {item.description.exact} ·{" "}
                        {item.quantity?.normalized ?? "cantidad sin dato"}{" "}
                        {item.unit ?? ""} · Total{" "}
                        {item.lineTotalMinor
                          ? displayValue(
                              "lineTotalMinor",
                              item.lineTotalMinor.normalized,
                            )
                          : "sin dato"}
                        {item.unitPriceMinor && (
                          <>
                            {" "}
                            · Precio unitario{" "}
                            {displayValue(
                              "unitPriceMinor",
                              item.unitPriceMinor.normalized,
                            )}
                          </>
                        )}
                        {item.discountMinor && (
                          <>
                            {" "}
                            · Descuento{" "}
                            {displayValue(
                              "discountMinor",
                              item.discountMinor.normalized,
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Sin ítems utilizables.</p>
                )}
                {proposal.conflicts.length > 0 && (
                  <div role="alert">
                    <h3>Valores en conflicto</h3>
                    {proposal.conflicts.map((conflict) => (
                      <div key={conflict.field}>
                        <p>
                          {fieldLabels[conflict.field]}: revisar las
                          alternativas antes de aprobar.
                        </p>
                        <ul>
                          {conflict.alternatives.map((alternative, index) => (
                            <li
                              key={`${alternative.evidence.regionId}-${index}`}
                            >
                              {displayValue(
                                conflict.field,
                                alternative.normalized,
                              )}{" "}
                              · Texto: {alternative.exact} · Fuente{" "}
                              {alternative.evidence.sourceId}, página{" "}
                              {alternative.evidence.page + 1}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                {proposal.warnings.length > 0 && (
                  <p>
                    Datos pendientes:{" "}
                    {proposal.warnings
                      .map((code) => warningLabels[code] ?? "dato incompleto")
                      .join(", ")}
                    .
                  </p>
                )}
              </section>
            )}
            <section className="workspace-card" aria-label="Fuente del recibo">
              <p>
                Archivo {index + 1} de {receipt.sourceIds.length}
              </p>
              <div className="actions">
                <Link href={`/workspaces/${workspaceId}/extraction`}>
                  Ver cola de extracción
                </Link>
                {role !== "viewer" &&
                  ["staged", "failed", "extracted"].includes(
                    receipt.status,
                  ) && (
                    <button
                      type="button"
                      onClick={() => void submitExtraction()}
                    >
                      Procesar recibo
                    </button>
                  )}
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  Anterior archivo
                </button>
                <button
                  type="button"
                  disabled={index >= receipt.sourceIds.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  Siguiente archivo
                </button>
                <Link
                  href={`/workspaces/${workspaceId}/receipts/${receiptId}/duplicates`}
                >
                  Revisar posibles duplicados
                </Link>
              </div>
              {type.startsWith("image/") && (
                <>
                  <div className="actions">
                    <label>
                      Zoom {zoom}%
                      <input
                        type="range"
                        min="50"
                        max="300"
                        value={zoom}
                        onChange={(event) =>
                          setZoom(Number(event.target.value))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setRotation((value) => (value + 90) % 360)}
                    >
                      Rotar 90°
                    </button>
                    <label>
                      Recorte visual {crop}%
                      <input
                        type="range"
                        min="0"
                        max="40"
                        value={crop}
                        onChange={(event) =>
                          setCrop(Number(event.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div
                    style={{
                      overflow: "auto",
                      minHeight: 300,
                      maxHeight: 650,
                      border: "1px solid #d8e0da",
                    }}
                  >
                    {url && (
                      <div
                        style={{
                          position: "relative",
                          width: `${zoom}%`,
                          minWidth: 1,
                          transform: `rotate(${rotation}deg)`,
                          clipPath: `inset(${crop}%)`,
                        }}
                      >
                        <Image
                          src={url}
                          alt={`Fuente ${index + 1} del recibo`}
                          unoptimized
                          width={1000}
                          height={1000}
                          style={{
                            display: "block",
                            width: "100%",
                            height: "auto",
                            maxWidth: "none",
                          }}
                        />
                        {selectedEvidence &&
                          selectedEvidence.sourceId === sourceId &&
                          selectedEvidence.box &&
                          selectedEvidence.page === 0 && (
                            <span
                              className="evidence-highlight"
                              aria-label="Región de origen"
                              style={{
                                left: `${selectedEvidence.box[0] * 100}%`,
                                top: `${selectedEvidence.box[1] * 100}%`,
                                width: `${(selectedEvidence.box[2] - selectedEvidence.box[0]) * 100}%`,
                                height: `${(selectedEvidence.box[3] - selectedEvidence.box[1]) * 100}%`,
                              }}
                            />
                          )}
                      </div>
                    )}
                  </div>
                </>
              )}
              {type === "application/pdf" && (
                <>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Página anterior
                    </button>
                    <label>
                      Página
                      <input
                        type="number"
                        min="1"
                        max={pageCount}
                        value={page}
                        onChange={(event) =>
                          setPage(
                            Math.min(
                              pageCount,
                              Math.max(1, Number(event.target.value) || 1),
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={page >= pageCount}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Página siguiente
                    </button>
                  </div>
                  {url && (
                    <PdfPage
                      url={url}
                      page={page}
                      evidence={
                        selectedEvidence?.sourceId === sourceId
                          ? selectedEvidence
                          : null
                      }
                      zoom={zoom}
                      onPageCount={setPageCount}
                    />
                  )}
                </>
              )}
              {url && (
                <p>
                  <a href={url} download={`recibo-${receiptId}-${index + 1}`}>
                    Descargar archivo
                  </a>
                </p>
              )}
            </section>
          </div>
          {proposal && (
            <ReviewEditor
              workspaceId={workspaceId}
              origin="receipt"
              originId={receiptId}
            />
          )}
        </>
      )}
    </main>
  );
}
