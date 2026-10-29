"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Workspace = { id: string; role: "owner" | "editor" | "viewer" };
type Receipt = { id: string; status: "staged"; sourceIds: string[] };
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export default function ReceiptIntakePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const [role, setRole] = useState<Workspace["role"] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setError("No se pudo verificar tu acceso.");
          return;
        }
        const session = (await response.json()) as { workspaces: Workspace[] };
        const workspace = session.workspaces.find(
          (item) => item.id === workspaceId,
        );
        if (!workspace) {
          setError("No se encontró el espacio de trabajo.");
          return;
        }
        setRole(workspace.role);
      })
      .catch(() => setError("No se pudo conectar."));
  }, [router, workspaceId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReceipt(null);
    if (
      files.length < 1 ||
      files.length > 20 ||
      files.some(
        (file) =>
          !allowedTypes.has(file.type) ||
          file.size < 1 ||
          file.size > 10 * 1024 * 1024,
      )
    ) {
      setError("Elige entre 1 y 20 imágenes o PDF de hasta 10 MB cada uno.");
      return;
    }
    setBusy(true);
    try {
      const sourceIds: string[] = [];
      for (const file of files) {
        const upload = await fetch(`/api/workspaces/${workspaceId}/sources`, {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-Source-Filename": file.name,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: file,
        });
        if (!upload.ok)
          throw new Error(
            "No se pudo subir uno de los archivos. Revisa su formato y vuelve a intentar.",
          );
        const data = (await upload.json()) as { source: { id: string } };
        sourceIds.push(data.source.id);
      }
      if (new Set(sourceIds).size !== sourceIds.length)
        throw new Error(
          "El mismo archivo aparece más de una vez. Elige archivos distintos.",
        );
      const staged = await fetch(`/api/workspaces/${workspaceId}/receipts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ sourceIds }),
      });
      if (!staged.ok)
        throw new Error("No se pudo crear el recibo. Intenta nuevamente.");
      const data = (await staged.json()) as { receipt: Receipt };
      setReceipt(data.receipt);
      setFiles([]);
      const input = document.getElementById(
        "receipt-files",
      ) as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo completar la carga.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Link href="/workspaces">← Espacios de trabajo</Link>
      <h1>Cargar recibo</h1>
      <p className="muted">
        Agrupa hasta 20 imágenes o PDF de un mismo recibo. El orden seleccionado
        será el orden de las páginas.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {role === "viewer" && (
        <p>Tu rol permite ver recibos, pero no cargarlos.</p>
      )}
      {(role === "owner" || role === "editor") && (
        <form onSubmit={submit}>
          <label htmlFor="receipt-files">Archivos del recibo</label>
          <input
            id="receipt-files"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            disabled={busy}
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <label htmlFor="receipt-camera">Tomar foto con la cámara</label>
          <input
            id="receipt-camera"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              const photo = event.target.files?.[0];
              if (photo) setFiles((current) => [...current, photo]);
              event.target.value = "";
            }}
          />
          <p className="muted">{files.length} archivo(s) seleccionados</p>
          <button type="submit" disabled={busy}>
            {busy ? "Cargando…" : "Crear recibo en espera"}
          </button>
        </form>
      )}
      {receipt && (
        <p role="status" className="success">
          Recibo {receipt.id} en estado «en espera» con{" "}
          {receipt.sourceIds.length} archivo(s).
        </p>
      )}
    </main>
  );
}
