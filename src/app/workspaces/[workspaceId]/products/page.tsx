"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Product, ProductMatch } from "@/server/catalog/product-service";

type Line = {
  index: number;
  description: string;
  lineTotalMinor: number | null;
  link: { productId: string; confidence: string } | null;
};
export default function ProductsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const search = useSearchParams();
  const base = `/api/workspaces/${workspaceId}/products`;
  const [products, setProducts] = useState<Product[]>([]);
  const [role, setRole] = useState("viewer");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [purchaseId, setPurchaseId] = useState(search.get("purchaseId") ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [version, setVersion] = useState(0);
  const [matches, setMatches] = useState<Record<number, ProductMatch[]>>({});
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [catalog, session] = await Promise.all([
      fetch(base),
      fetch("/api/auth/session"),
    ]);
    if (catalog.ok) setProducts((await catalog.json()).result);
    if (session.ok)
      setRole(
        (
          (await session.json()).workspaces as { id: string; role: string }[]
        ).find((w) => w.id === workspaceId)?.role ?? "viewer",
      );
  }, [base, workspaceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function mutate(operation: object) {
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(operation),
    });
    if (response.ok) {
      setMessage("Producto actualizado.");
      await load();
      if (purchaseId) await loadLines();
    } else
      setMessage(
        (await response.json()).error?.message ?? "No se pudo guardar.",
      );
  }
  async function loadLines() {
    const response = await fetch(
      `${base}?purchaseId=${encodeURIComponent(purchaseId)}`,
    );
    if (!response.ok) {
      setMessage("No se encontró la compra aprobada.");
      return;
    }
    const result = (await response.json()).result as {
      lines: Line[];
      reviewVersion: number;
    };
    setLines(result.lines);
    setVersion(result.reviewVersion);
    setMatches({});
  }
  async function suggest(line: Line) {
    const response = await fetch(
      `${base}?suggest=${encodeURIComponent(line.description)}`,
    );
    if (response.ok) {
      const result = (await response.json()).result as ProductMatch[];
      setMatches((prior) => ({ ...prior, [line.index]: result }));
    }
  }
  function link(line: Line, productId: string, uncertain: boolean) {
    if (
      uncertain &&
      !window.confirm("La identidad o marca no es segura. ¿Confirmar?")
    )
      return;
    void mutate({
      action: "link",
      purchaseId,
      lineIndex: line.index,
      productId,
      brand: null,
      confirmUncertain: uncertain,
      expectedReviewVersion: version,
    });
  }
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/inbox`}>
          Volver a la bandeja
        </Link>
      </p>
      <h1>Productos</h1>
      <p>
        La descripción del recibo se conserva. Las diferencias de marca
        requieren confirmación.
      </p>
      {message && <p role="status">{message}</p>}
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            {product.name}
            {product.brand ? ` · ${product.brand}` : ""}
            {role !== "viewer" && (
              <button
                type="button"
                onClick={() => {
                  const next = window.prompt("Nuevo nombre", product.name);
                  if (next?.trim())
                    void mutate({
                      action: "rename",
                      productId: product.id,
                      name: next,
                      brand: product.brand,
                    });
                }}
              >
                Renombrar
              </button>
            )}
          </li>
        ))}
      </ul>
      {role !== "viewer" && (
        <section>
          <h2>Crear producto</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({
                action: "create",
                name,
                brand: brand.trim() || null,
              });
              setName("");
              setBrand("");
            }}
          >
            <label>
              Nombre{" "}
              <input
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Marca{" "}
              <input
                maxLength={120}
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
              />
            </label>
            <button>Crear</button>
          </form>
        </section>
      )}
      <section>
        <h2>Vincular líneas aprobadas</h2>
        <label>
          ID de compra aprobada{" "}
          <input
            value={purchaseId}
            onChange={(event) => setPurchaseId(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void loadLines()}>
          Ver líneas
        </button>
        <ul>
          {lines.map((line) => (
            <li key={line.index}>
              {line.description}{" "}
              {line.link &&
                `→ ${products.find((p) => p.id === line.link?.productId)?.name ?? line.link.productId}`}
              <button type="button" onClick={() => void suggest(line)}>
                Buscar coincidencias
              </button>
              {matches[line.index]?.map((match) => (
                <button
                  key={match.product.id}
                  disabled={role === "viewer"}
                  type="button"
                  onClick={() =>
                    link(
                      line,
                      match.product.id,
                      match.confidence === "uncertain",
                    )
                  }
                >
                  {match.product.name} (
                  {match.confidence === "high"
                    ? "coincidencia exacta"
                    : "confirmación necesaria"}
                  )
                </button>
              ))}
              {role !== "viewer" && (
                <select
                  aria-label={`Vincular línea ${line.index + 1}`}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value)
                      link(line, event.target.value, true);
                  }}
                >
                  <option value="">Elegir otro producto…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
