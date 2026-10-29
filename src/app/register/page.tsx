"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
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
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "No se pudo crear la cuenta con esos datos."
            : "Revisa el correo y usa una contraseña de 12 a 128 caracteres.",
        );
        return;
      }
      router.replace("/login");
    } catch {
      setError("No se pudo conectar. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Crear cuenta</h1>
      <p>Usa una contraseña de 12 a 128 caracteres.</p>
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
            autoComplete="new-password"
            required
            type="password"
            minLength={12}
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
          {busy ? "Creando cuenta…" : "Crear cuenta"}
        </button>
      </form>
      <p>
        ¿Ya tienes una cuenta? <Link href="/login">Iniciar sesión</Link>
      </p>
    </main>
  );
}
