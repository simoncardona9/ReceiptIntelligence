"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Category } from "@/server/catalog/category-service";

export default function CategoriesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [mappings, setMappings] = useState<
    { sourceName: string; categoryId: string }[]
  >([]);
  const [role, setRole] = useState("viewer");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [suggestions, setSuggestions] = useState<
    { category: Category; score: number }[]
  >([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/categories`;

  const load = useCallback(async () => {
    const [catalog, session] = await Promise.all([
      fetch(base, { cache: "no-store" }),
      fetch("/api/auth/session", { cache: "no-store" }),
    ]);
    if (catalog.ok) {
      const data = await catalog.json();
      setCategories(data.categories);
      setMappings(data.mappings);
    } else setMessage("No se pudo cargar el catálogo.");
    if (session.ok) {
      const data = await session.json();
      setRole(
        data.workspaces.find((w: { id: string }) => w.id === workspaceId)
          ?.role ?? "viewer",
      );
    }
  }, [base, workspaceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function mutate(body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json();
        setMessage(data.error?.message ?? "No se pudo guardar.");
      } else {
        setMessage("Catálogo actualizado.");
        await load();
      }
    } catch {
      setMessage("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }
  async function suggest() {
    const response = await fetch(
      `${base}?suggest=${encodeURIComponent(sourceName)}`,
    );
    if (response.ok) setSuggestions((await response.json()).suggestions);
  }
  const active = categories.filter((item) => !item.archivedAt);
  return (
    <main>
      <p>
        <Link href={`/workspaces/${workspaceId}/inbox`}>
          Volver a la bandeja
        </Link>
      </p>
      <h1>Categorías</h1>
      {message && <p role="status">{message}</p>}
      {categories.length === 0 && role !== "viewer" && (
        <button disabled={busy} onClick={() => void mutate({ action: "seed" })}>
          Importar categorías iniciales de ProyectoFinanzas
        </button>
      )}
      <ul>
        {categories.map((item) => (
          <li key={item.id}>
            {item.parentId
              ? `${categories.find((parent) => parent.id === item.parentId)?.name ?? ""} / `
              : ""}
            {item.name} {item.archivedAt ? "(archivada)" : ""}
            {role === "owner" && !item.archivedAt && (
              <span>
                {" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate({ action: "archive", categoryId: item.id })
                  }
                >
                  Archivar
                </button>
                <select
                  aria-label={`Fusionar ${item.name} en`}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value)
                      void mutate({
                        action: "merge",
                        categoryId: item.id,
                        targetId: event.target.value,
                      });
                  }}
                >
                  <option value="">Fusionar en…</option>
                  {active
                    .filter((candidate) => candidate.id !== item.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </select>
              </span>
            )}
          </li>
        ))}
      </ul>
      {role !== "viewer" && (
        <>
          <section>
            <h2>Crear categoría</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate({
                  action: "create",
                  name,
                  parentId: parentId || null,
                });
                setName("");
              }}
            >
              <label>
                Nombre{" "}
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Superior{" "}
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">Ninguna</option>
                  {active.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Crear</button>
            </form>
          </section>
          <section>
            <h2>Relacionar nombre de recibo</h2>
            <p>
              Las sugerencias no crean categorías ni relaciones automáticamente.
            </p>
            <label>
              Nombre observado{" "}
              <input
                value={sourceName}
                maxLength={120}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </label>
            <button type="button" onClick={() => void suggest()}>
              Buscar sugerencias
            </button>
            {suggestions.length > 0 && (
              <p>
                Sugerencias:{" "}
                {suggestions.map((item) => item.category.name).join(", ")}
              </p>
            )}
            <label>
              Categoría confirmada{" "}
              <select
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">Elegir…</option>
                {active.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !sourceName.trim() || !targetId}
              type="button"
              onClick={() =>
                void mutate({ action: "map", sourceName, categoryId: targetId })
              }
            >
              Confirmar relación
            </button>
            <ul>
              {mappings.map((item) => (
                <li key={item.sourceName}>
                  {item.sourceName} →{" "}
                  {
                    categories.find(
                      (category) => category.id === item.categoryId,
                    )?.name
                  }
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
