"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Receipt = { id: string; status: "staged"; sourceIds: string[] };

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
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(0);
  const [error, setError] = useState("");

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
    } catch {
      setError("No se pudo abrir el recibo.");
    }
  }, [workspaceId, receiptId, router]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadReceipt(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReceipt]);

  const sourceId = receipt?.sourceIds[index];
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
          setPage(1);
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
  }, [workspaceId, sourceId]);

  return (
    <main>
      <Link href={`/workspaces/${workspaceId}/inbox`}>← Bandeja</Link>
      <h1>Revisar fuente</h1>
      <p>
        Recibo {receiptId} ·{" "}
        {receipt?.status === "staged" ? "En espera" : "Cargando…"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {receipt && (
        <>
          <p>
            Archivo {index + 1} de {receipt.sourceIds.length}
          </p>
          <div className="actions">
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
                    onChange={(event) => setZoom(Number(event.target.value))}
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
                    onChange={(event) => setCrop(Number(event.target.value))}
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
                  <Image
                    src={url}
                    alt={`Fuente ${index + 1} del recibo`}
                    unoptimized
                    width={1000}
                    height={1000}
                    style={{
                      display: "block",
                      width: `${zoom}%`,
                      height: "auto",
                      maxWidth: "none",
                      transform: `rotate(${rotation}deg)`,
                      clipPath: `inset(${crop}%)`,
                    }}
                  />
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
                    value={page}
                    onChange={(event) =>
                      setPage(Math.max(1, Number(event.target.value) || 1))
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPage((value) => value + 1)}
                >
                  Página siguiente
                </button>
              </div>
              {url && (
                <iframe
                  title="Vista previa PDF"
                  src={`${url}#page=${page}`}
                  style={{
                    width: "100%",
                    minHeight: 650,
                    border: "1px solid #d8e0da",
                  }}
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
        </>
      )}
    </main>
  );
}
