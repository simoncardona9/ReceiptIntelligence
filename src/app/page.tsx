import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>ReceiptIntelligence</h1>
      <p>
        Gestiona gastos del hogar con revisión y acceso por espacio de trabajo.
      </p>
      <nav aria-label="Acceso">
        <Link href="/login">Iniciar sesión</Link>
        <Link href="/register">Crear cuenta</Link>
      </nav>
    </main>
  );
}
