"use client";

import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@/server/extraction/normalization";

export function PdfPage({
  url,
  page,
  evidence,
  zoom,
  onPageCount,
}: {
  url: string;
  page: number;
  evidence: Evidence | null;
  zoom: number;
  onPageCount: (count: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let loading: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const loadTask = pdfjs.getDocument({ url });
        loading = loadTask;
        const pdf = await loadTask.promise;
        if (cancelled) return;
        onPageCount(pdf.numPages);
        if (page > pdf.numPages) return;
        const pdfPage = await pdf.getPage(page);
        if (cancelled || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: zoom / 100 });
        const context = canvas.current.getContext("2d");
        if (!context) return;
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        task = pdfPage.render({
          canvas: canvas.current,
          canvasContext: context,
          viewport,
        });
        await task.promise;
        if (!cancelled) setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      void loading?.destroy();
    };
  }, [url, page, zoom, onPageCount]);
  return (
    <>
      {error && <p role="alert">No se pudo mostrar esta página PDF.</p>}
      <div style={{ overflow: "auto", maxHeight: 650 }}>
        <div style={{ position: "relative", width: "fit-content" }}>
          <canvas
            ref={canvas}
            aria-label={`Página PDF ${page}`}
            style={{ display: "block", maxWidth: "none" }}
          />
          {evidence?.page === page - 1 && evidence.box && (
            <span
              className="evidence-highlight"
              aria-label="Región de origen"
              style={{
                left: `${evidence.box[0] * 100}%`,
                top: `${evidence.box[1] * 100}%`,
                width: `${(evidence.box[2] - evidence.box[0]) * 100}%`,
                height: `${(evidence.box[3] - evidence.box[1]) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      {evidence?.page === page - 1 && !evidence.box && (
        <p>Región de origen no disponible.</p>
      )}
    </>
  );
}
