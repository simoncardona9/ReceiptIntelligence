"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Suggestion = { receiptId: string; decision: "same" | "different" | null };

export default function DuplicateReviewPage() {
  const { workspaceId, receiptId } = useParams<{
    workspaceId: string;
    receiptId: string;
  }>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/receipts/${receiptId}/duplicates`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { suggestions: Suggestion[] };
      setSuggestions(data.suggestions);
    } catch {
      setError("No se pudieron cargar las sugerencias.");
    }
  }, [workspaceId, receiptId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function decide(candidateId: string, decision: "same" | "different") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/receipts/${receiptId}/duplicates/${candidateId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError("No se pudo guardar la decisión.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <Link href={`/workspaces/${workspaceId}/intake`}>← Cargar recibo</Link>
      <h1>Posibles duplicados</h1>
      <p className="muted">
        La coincidencia usa comercio, fecha, total y moneda ingresados.
        Confirmar conserva ambos recibos y sus fuentes.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {suggestions.length === 0 && (
        <p>No hay coincidencias con los datos disponibles.</p>
      )}
      {suggestions.map((item) => (
        <article className="workspace-card" key={item.receiptId}>
          <p>Recibo {item.receiptId}</p>
          {item.decision ? (
            <p>
              Decisión:{" "}
              {item.decision === "same" ? "mismo recibo" : "recibos distintos"}
            </p>
          ) : (
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide(item.receiptId, "same")}
              >
                Es el mismo recibo
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide(item.receiptId, "different")}
              >
                Son distintos
              </button>
            </div>
          )}
        </article>
      ))}
    </main>
  );
}
