/** UI-only conversion. API and persistence continue to use integer centésimos. */
export function parsePesos(value: string): number | null {
  const input = value.trim();
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(input);
  const plain = /^\d+(?:[,.]\d{1,2})?$/.test(input);
  if (!grouped && !plain) return null;
  const normalized = grouped ? input.replace(/\./g, "") : input;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const minor =
    BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function pesosInput(minor: number): string {
  return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`;
}

export function pesosDisplay(minor: number): string {
  const whole = new Intl.NumberFormat("es-UY", {
    maximumFractionDigits: 0,
  }).format(BigInt(Math.floor(minor / 100)));
  return `${whole},${String(minor % 100).padStart(2, "0")}`;
}
