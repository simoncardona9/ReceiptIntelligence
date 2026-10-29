"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Line = { description: string; quantityMilli: string; totalMinor: string };

export default function NewManualExpensePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [totalMinor, setTotalMinor] = useState("");
  const [currency, setCurrency] = useState<"UYU" | "USD">("UYU");
  const [categoryName, setCategoryName] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) throw new Error();
          const body = (await response.json()) as {
            workspaces: { id: string; role: string }[];
          };
          const membership = body.workspaces.find(
            (item) => item.id === workspaceId,
          );
          if (!membership || membership.role === "viewer") {
            setError("Tu rol no permite crear gastos manuales.");
            return;
          }
          setAllowed(true);
        })
        .catch(() => setError("No se pudo verificar tu acceso."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, workspaceId]);

  function editLine(index: number, field: keyof Line, value: string) {
    setLines((current) =>
      current.map((line, at) =>
        at === index ? { ...line, [field]: value } : line,
      ),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/manual-expenses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            merchant,
            date,
            totalMinor: Number(totalMinor),
            currency,
            ...(categoryName.trim()
              ? { categoryName: categoryName.trim() }
              : {}),
            lines: lines.map((line) => ({
              description: line.description,
              quantityMilli: Number(line.quantityMilli),
              totalMinor: Number(line.totalMinor),
            })),
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          "No se pudo guardar el gasto. Revisa los datos e intenta nuevamente.",
        );
      const body = (await response.json()) as { expense: { id: string } };
      setCreatedId(body.expense.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo guardar el gasto.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Link href="/workspaces">← Espacios de trabajo</Link>
      <h1>Gasto manual</h1>
      <p className="muted">
        Este gasto no tiene archivo de recibo ni datos de extracción. Quedará en
        espera de revisión.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {allowed && (
        <form onSubmit={submit}>
          <label>
            Comercio
            <input
              required
              maxLength={160}
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
            />
          </label>
          <label>
            Fecha
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Total en centésimos
            <input
              required
              type="number"
              min="0"
              step="1"
              value={totalMinor}
              onChange={(event) => setTotalMinor(event.target.value)}
            />
          </label>
          <label>
            Moneda
            <select
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value as "UYU" | "USD")
              }
            >
              <option value="UYU">UYU</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            Categoría provisional
            <input
              maxLength={120}
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
          </label>
          <h2>Artículos opcionales</h2>
          {lines.map((line, index) => (
            <fieldset key={index}>
              <legend>Artículo {index + 1}</legend>
              <label>
                Descripción
                <input
                  required
                  maxLength={240}
                  value={line.description}
                  onChange={(event) =>
                    editLine(index, "description", event.target.value)
                  }
                />
              </label>
              <label>
                Cantidad en milésimos
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantityMilli}
                  onChange={(event) =>
                    editLine(index, "quantityMilli", event.target.value)
                  }
                />
              </label>
              <label>
                Total en centésimos
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={line.totalMinor}
                  onChange={(event) =>
                    editLine(index, "totalMinor", event.target.value)
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setLines((current) => current.filter((_, at) => at !== index))
                }
              >
                Quitar artículo
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={busy || lines.length >= 100}
            onClick={() =>
              setLines((current) => [
                ...current,
                { description: "", quantityMilli: "1000", totalMinor: "" },
              ])
            }
          >
            Agregar artículo
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Crear gasto en espera"}
          </button>
        </form>
      )}
      {createdId && (
        <p role="status" className="success">
          Gasto manual {createdId} creado en estado «en espera».
        </p>
      )}
    </main>
  );
}
