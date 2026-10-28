"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Correo o contraseña incorrectos."
            : "No se pudo iniciar sesión.",
        );
        return;
      }
      router.replace("/workspaces");
    } catch {
      setError("No se pudo conectar. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Iniciar sesión</h1>
      <form onSubmit={submit}>
        <label>
          Correo electrónico
          <input
            autoComplete="email"
            required
            type="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            autoComplete="current-password"
            required
            type="password"
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} type="submit">
          {busy ? "Ingresando…" : "Iniciar sesión"}
        </button>
      </form>
      <p>
        ¿No tienes una cuenta? <Link href="/register">Crear cuenta</Link>
      </p>
    </main>
  );
}
