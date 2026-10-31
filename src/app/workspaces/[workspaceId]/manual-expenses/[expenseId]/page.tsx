"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pesosDisplay } from "@/app/money";
import { ReviewEditor } from "../../review-editor";

type Expense = {
  id: string;
  origin: "manual";
  status: "staged";
  merchant: string;
  date: string;
  totalMinor: number;
  currency: "UYU" | "USD";
  categoryName?: string;
  lines: { description: string; quantityMilli: number; totalMinor: number }[];
};

export default function ManualExpenseDetailPage() {
  const { workspaceId, expenseId } = useParams<{
    workspaceId: string;
    expenseId: string;
  }>();
  const router = useRouter();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/workspaces/${workspaceId}/manual-expenses/${expenseId}`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) throw new Error();
          const body = (await response.json()) as { expense: Expense };
          setExpense(body.expense);
        })
        .catch(() => setError("No se pudo abrir el gasto manual."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceId, expenseId, router]);
  return (
    <main>
      <Link href={`/workspaces/${workspaceId}/inbox`}>← Bandeja</Link>
      <h1>Gasto manual</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {expense && (
        <>
          <p className="muted">ID: {expense.id} · Sin archivo ni extracción</p>
          <dl className="expense-summary">
            <div>
              <dt>Comercio</dt>
              <dd>{expense.merchant}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{expense.date}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>
                {pesosDisplay(expense.totalMinor)} {expense.currency}
              </dd>
            </div>
            <div>
              <dt>Categoría provisional</dt>
              <dd>{expense.categoryName ?? "Sin categoría"}</dd>
            </div>
          </dl>
          <h2>Artículos</h2>
          {expense.lines.length === 0 && <p>Sin artículos detallados.</p>}
          <ul>
            {expense.lines.map((line, index) => (
              <li key={index}>
                {line.description} · {line.quantityMilli} milésimos ·{" "}
                {pesosDisplay(line.totalMinor)} {expense.currency}
              </li>
            ))}
          </ul>
          <ReviewEditor
            workspaceId={workspaceId}
            origin="manual"
            originId={expenseId}
          />
        </>
      )}
    </main>
  );
}
