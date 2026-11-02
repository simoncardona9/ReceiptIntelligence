"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { parsePesos, pesosDisplay } from "@/app/money";
import type { Category } from "@/server/catalog/category-service";
import type { Allocation } from "@/server/allocations/allocation-service";

type Line = {
  description: string;
  lineTotalMinor: number | null;
  taxMinor?: number | null;
};
export default function AllocationsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const search = useSearchParams();
  const [purchaseId, setPurchaseId] = useState(search.get("purchaseId") ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [role, setRole] = useState("viewer");
  const [lines, setLines] = useState<Line[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [tax, setTax] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [primary, setPrimary] = useState("");
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const root = `/api/workspaces/${workspaceId}`;
  const loadCatalog = useCallback(async () => {
    const [catalog, session] = await Promise.all([
      fetch(`${root}/categories`),
      fetch("/api/auth/session"),
    ]);
    if (catalog.ok) setCategories((await catalog.json()).categories);
    if (session.ok)
      setRole(
        (
          (await session.json()).workspaces as { id: string; role: string }[]
        ).find((w) => w.id === workspaceId)?.role ?? "viewer",
      );
  }, [root, workspaceId]);
  const loadPurchase = useCallback(async () => {
    if (!purchaseId) return;
    const response = await fetch(
      `${root}/allocations?purchaseId=${encodeURIComponent(purchaseId)}`,
    );
    if (!response.ok) {
      setMessage("No se encontró la compra aprobada.");
      return;
    }
    const result = (await response.json()).result as {
      allocations: Allocation[];
      reviewVersion: number;
      stale: boolean;
      totalMinor: number | null;
      taxMinor: number | null;
      lineItems: Line[];
    };
    setLines(result.lineItems);
    setAllocations(result.allocations);
    setVersion(result.reviewVersion);
    setTotal(result.totalMinor);
    setTax(result.taxMinor);
    setStale(result.stale);
    setSelected(
      Object.fromEntries(
        result.allocations.flatMap((row) =>
          row.lineIndexes.map((index) => [index, row.categoryId]),
        ),
      ),
    );
    setPrimary(
      result.allocations.find((row) => row.kind === "remainder")?.categoryId ??
        "",
    );
  }, [root, purchaseId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog();
      void loadPurchase();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog, loadPurchase]);
  async function save() {
    if (!primary) {
      setMessage("Selecciona la categoría restante.");
      return;
    }
    if (
      Object.values(overrides).some(
        (value) => value.trim() && parsePesos(value) === null,
      )
    ) {
      setMessage("Importe manual inválido.");
      return;
    }
    const groups = [...new Set(Object.values(selected).filter(Boolean))].map(
      (categoryId) => {
        const amount = overrides[categoryId]?.trim();
        const overrideAmountMinor = amount ? parsePesos(amount) : undefined;
        return {
          categoryId,
          lineIndexes: Object.entries(selected)
            .filter(([, value]) => value === categoryId)
            .map(([index]) => Number(index)),
          ...(overrideAmountMinor === undefined ? {} : { overrideAmountMinor }),
          ...(reasons[categoryId]?.trim()
            ? { reason: reasons[categoryId].trim() }
            : {}),
        };
      },
    );
    const response = await fetch(`${root}/allocations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        purchaseId,
        expectedReviewVersion: version,
        primaryCategoryId: primary,
        groups,
      }),
    });
    if (response.ok) {
      setMessage("Distribución guardada.");
      await loadPurchase();
    } else
      setMessage(
        (await response.json()).error?.message ?? "No se pudo guardar.",
      );
  }
  const active = categories.filter((category) => !category.archivedAt);
  const selectedCategories = [
    ...new Set(Object.values(selected).filter(Boolean)),
  ];
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/inbox`}>
          Volver a la bandeja
        </Link>
      </p>
      <h1>Distribución por categorías</h1>
      <p>
        Los importes se calculan de las líneas. El IVA del recibo permanece
        independiente.
      </p>
      {message && <p role="status">{message}</p>}
      <label>
        ID de compra aprobada{" "}
        <input
          value={purchaseId}
          onChange={(event) => setPurchaseId(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => void loadPurchase()}>
        Ver compra
      </button>
      {total !== null && (
        <p>
          Total: {pesosDisplay(total)} · IVA del recibo:{" "}
          {tax === null ? "desconocido" : pesosDisplay(tax)}
        </p>
      )}
      {stale && (
        <p role="alert">
          La compra cambió desde la última distribución. Revisa y guarda de
          nuevo.
        </p>
      )}
      {allocations.length > 0 && (
        <section>
          <h2>Distribución vigente</h2>
          <ul>
            {allocations.map((row) => (
              <li key={row.id}>
                {categories.find((category) => category.id === row.categoryId)
                  ?.name ?? row.categoryId}
                : {pesosDisplay(row.amountMinor)}
                {row.kind === "remainder"
                  ? " (restante)"
                  : ` (líneas ${row.lineIndexes.map((index) => index + 1).join(", ")})`}
                {row.reason && ` · Motivo: ${row.reason}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {lines.length > 0 && (
        <section>
          <h2>Seleccionar líneas</h2>
          <ul>
            {lines.map((line, index) => (
              <li key={index}>
                {line.description} ·{" "}
                {line.lineTotalMinor === null
                  ? "sin importe"
                  : pesosDisplay(line.lineTotalMinor)}
                {line.taxMinor != null &&
                  ` · IVA explícito ${pesosDisplay(line.taxMinor)}`}
                {role !== "viewer" && (
                  <select
                    aria-label={`Categoría para línea ${index + 1}`}
                    value={selected[index] ?? ""}
                    onChange={(event) =>
                      setSelected((prior) => ({
                        ...prior,
                        [index]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Dejar en restante</option>
                    {active.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {role !== "viewer" && total !== null && (
        <section>
          <h2>Guardar distribución</h2>
          <label>
            Categoría del importe restante{" "}
            <select
              value={primary}
              onChange={(event) => setPrimary(event.target.value)}
            >
              <option value="">Elegir…</option>
              {active.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          {selectedCategories.map((categoryId) => (
            <div key={categoryId}>
              <p>
                {
                  categories.find((category) => category.id === categoryId)
                    ?.name
                }
              </p>
              <label>
                Importe manual opcional{" "}
                <input
                  value={overrides[categoryId] ?? ""}
                  onChange={(event) =>
                    setOverrides((prior) => ({
                      ...prior,
                      [categoryId]: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Motivo del ajuste{" "}
                <input
                  value={reasons[categoryId] ?? ""}
                  onChange={(event) =>
                    setReasons((prior) => ({
                      ...prior,
                      [categoryId]: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          ))}
          <button type="button" onClick={() => void save()}>
            Guardar
          </button>
        </section>
      )}
    </main>
  );
}
