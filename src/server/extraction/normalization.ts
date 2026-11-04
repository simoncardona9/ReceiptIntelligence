import type { ExtractionResult } from "./contracts";

export type Evidence = {
  sourceId: string;
  page: number;
  regionId: string;
  box: [number, number, number, number] | null;
};
export type Candidate<T> = {
  exact: string;
  normalized: T;
  confidence: number | null;
  evidence: Evidence;
};
export type ProposalFields = {
  merchant: Candidate<string> | null;
  date: Candidate<string> | null;
  totalMinor: Candidate<number> | null;
  currency: Candidate<"UYU" | "USD"> | null;
  subtotalMinor: Candidate<number> | null;
  taxMinor: Candidate<number> | null;
  paymentMethod: Candidate<string> | null;
};
export type ProposedLine = {
  description: Candidate<string>;
  quantity: Candidate<string> | null;
  unit: string | null;
  unitPriceMinor: Candidate<number> | null;
  discountMinor: Candidate<number> | null;
  lineTotalMinor: Candidate<number> | null;
};
export type Proposal = {
  version: 1;
  fields: ProposalFields;
  lineItems: ProposedLine[];
  conflicts: {
    field: keyof ProposalFields;
    alternatives: Candidate<string | number>[];
  }[];
  warnings: string[];
};

type Region = {
  sourceId: string;
  page: number;
  regionId: string;
  text: string;
  confidence: number | null;
  box: Evidence["box"];
};

function key(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function candidate<T>(region: Region, normalized: T): Candidate<T> {
  return {
    exact: region.text,
    normalized,
    confidence: region.confidence,
    evidence: {
      sourceId: region.sourceId,
      page: region.page,
      regionId: region.regionId,
      box: region.box,
    },
  };
}

export function parseMoneyMinor(text: string): number | null {
  const matches = [...text.matchAll(/-?\d[\d.\s]*(?:,\d{1,2})?(?:\.\d{2})?/g)]
    .map((match) => match[0].trim())
    .filter(Boolean);
  const raw = matches.at(-1);
  if (!raw || raw.startsWith("-")) return null;
  const compact = raw.replace(/\s/g, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let decimalIndex = -1;
  if (comma >= 0 && dot >= 0) decimalIndex = Math.max(comma, dot);
  else if (comma >= 0 && /^\d{1,2}$/.test(compact.slice(comma + 1)))
    decimalIndex = comma;
  else if (dot >= 0 && /^\d{1,2}$/.test(compact.slice(dot + 1)))
    decimalIndex = dot;
  const whole = (
    decimalIndex < 0 ? compact : compact.slice(0, decimalIndex)
  ).replace(/[.,]/g, "");
  const fraction =
    decimalIndex < 0 ? "00" : compact.slice(decimalIndex + 1).padEnd(2, "0");
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(fraction)) return null;
  const value = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function parseReceiptDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const local = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (!iso && !local) return null;
  const year = Number(iso?.[1] ?? local?.[3]);
  const month = Number(iso?.[2] ?? local?.[2]);
  const day = Number(iso?.[3] ?? local?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currency(text: string): "UYU" | "USD" | null {
  const upper = key(text);
  if (/\bUSD\b|U\$S|DOLARES|DOLAR AMERICANO/.test(upper)) return "USD";
  if (/\bUYU\b|PESOS URUGUAYOS/.test(upper)) return "UYU";
  return null;
}

function payment(text: string): string | null {
  const upper = key(text);
  if (/TRANSFERENCIA/.test(upper)) return "transfer";
  if (/EFECTIVO/.test(upper)) return "cash";
  if (/DEBITO/.test(upper)) return "debit_card";
  if (/CREDITO/.test(upper)) return "credit_card";
  return null;
}

function quantity(text: string): { value: string; unit: string | null } | null {
  const match = key(text).match(
    /^(\d+(?:[,.]\d{1,3})?)\s*(UN|KG|G|L|ML|KWH)?$/,
  );
  if (!match) return null;
  return { value: match[1].replace(",", "."), unit: match[2] ?? null };
}

function orderedRegions(result: ExtractionResult): Region[] {
  return result.pages
    .flatMap((page) =>
      page.regions.map((region) => ({
        sourceId: page.sourceId,
        page: page.page,
        regionId: region.id,
        text: region.text.trim(),
        confidence: region.confidence,
        box: region.box,
      })),
    )
    .filter((region) => region.text.length > 0);
}

function numericRegion(region: Region): number | null {
  // A price column must contain an amount, not a stock code or a quantity.
  if (!/^(?:[$€]\s*)?\d{1,6}(?:[.,]\d{2})$/.test(region.text.trim()))
    return null;
  return parseMoneyMinor(region.text);
}

function layoutItems(regions: Region[]): ProposedLine[] | null {
  const boxed = regions.filter((region) => region.box !== null);
  if (boxed.length < 12 || boxed.length / regions.length < 0.8) return null;
  const sections = boxed.filter((region) =>
    /CONSUMO FINAL|DETALLE DE (?:COMPRA|PRODUCTOS)|DESCRIPCION\s+IMPORTE/.test(
      key(region.text),
    ),
  );
  if (!sections.length) return null;
  const start = Math.max(...sections.map((region) => region.box![3]));
  const end = Math.min(
    ...boxed
      .filter(
        (region) =>
          region.box![1] > start &&
          /^(?:TOTAL|SUB\s*TOTAL|DETALLE DE IMPUESTOS)\b/.test(
            key(region.text),
          ),
      )
      .map((region) => region.box![1]),
    1,
  );
  const body = boxed
    .filter((region) => region.box![1] >= start && region.box![1] < end)
    .sort((a, b) => a.box![1] - b.box![1] || a.box![0] - b.box![0]);
  const descriptions = body.filter(
    (region) =>
      region.box![0] < 0.58 &&
      /[A-ZÁÉÍÓÚÑ]{3}/i.test(region.text) &&
      !/^(?:\d|X\b|PRECIO\b)/.test(key(region.text)) &&
      !/\b(?:KG\s*X|X\s*\d)/.test(key(region.text)),
  );
  if (!descriptions.length) return null;
  const items: ProposedLine[] = [];
  for (let index = 0; index < descriptions.length; index++) {
    const description = descriptions[index];
    const top = description.box![1] - 0.004;
    const next = descriptions[index + 1]?.box![1] ?? end;
    const row = body.filter(
      (region) =>
        region !== description &&
        region.box![1] >= top &&
        region.box![1] < next,
    );
    const prices = row
      .filter((region) => region.box![0] > 0.62)
      .map((region) => ({ region, amount: numericRegion(region) }))
      .filter(
        (entry): entry is { region: Region; amount: number } =>
          entry.amount !== null,
      );
    const price = prices.at(-1);
    const unitPrice = price
      ? row
          .filter(
            (region) =>
              region.box![0] > description.box![0] + 0.08 &&
              region.box![0] < price.region.box![0] - 0.02,
          )
          .map((region) => ({ region, amount: numericRegion(region) }))
          .find((entry) => entry.amount !== null)
      : null;
    const detail = row.find((region) =>
      /\b\d{1,3}[,.]\d{3}\s*KG\b|^\s*\d{1,3}[,.]\d{3}\s*X\b/i.test(region.text),
    );
    const count = row.find(
      (region) =>
        region.box![0] < 0.62 && /^\s*\d{1,3}\s*X\s*$/.test(region.text),
    );
    const parsedQuantity = detail
      ? detail.text.match(/(\d{1,3})[,.](\d{3})/)
      : null;
    items.push({
      description: candidate(description, description.text),
      quantity: parsedQuantity
        ? candidate(detail!, `${parsedQuantity[1]}.${parsedQuantity[2]}`)
        : count
          ? candidate(count, count.text.trim().replace(/\s*X\s*$/i, ""))
          : null,
      unit: parsedQuantity ? "KG" : count ? "UN" : null,
      unitPriceMinor:
        unitPrice && unitPrice.amount !== null
          ? candidate(unitPrice.region, unitPrice.amount)
          : null,
      discountMinor: null,
      lineTotalMinor: price ? candidate(price.region, price.amount) : null,
    });
  }
  return items;
}

function splitLabelAmount(
  regions: Region[],
  label: Region,
): Candidate<number> | null {
  if (!label.box) return null;
  const nearby = regions
    .filter(
      (region) =>
        region !== label &&
        region.sourceId === label.sourceId &&
        region.page === label.page &&
        region.box &&
        region.box[0] > label.box![0] &&
        Math.abs(
          (region.box[1] + region.box[3]) / 2 -
            (label.box![1] + label.box![3]) / 2,
        ) < 0.006,
    )
    .map((region) => ({ region, amount: numericRegion(region) }))
    .filter(
      (entry): entry is { region: Region; amount: number } =>
        entry.amount !== null,
    );
  const value = nearby.at(-1);
  return value ? candidate(value.region, value.amount) : null;
}

export function normalizeExtraction(result: ExtractionResult): Proposal {
  const regions = orderedRegions(result);
  const options: { [K in keyof ProposalFields]: Candidate<never>[] } = {
    merchant: [],
    date: [],
    totalMinor: [],
    currency: [],
    subtotalMinor: [],
    taxMinor: [],
    paymentMethod: [],
  };
  const lineItems: ProposedLine[] = [];
  let current: ProposedLine | null = null;
  let summary = false;
  const flush = () => {
    if (current?.lineTotalMinor) lineItems.push(current);
    current = null;
  };

  for (const region of regions) {
    const upper = key(region.text);
    if (/\b(?:\d[ -]?){13,19}\b/.test(region.text)) continue;
    const amount = parseMoneyMinor(region.text);
    const date = parseReceiptDate(region.text);
    const unit = currency(region.text);
    const method = payment(region.text);
    if (unit)
      options.currency.push(candidate(region, unit) as Candidate<never>);
    if (date && !summary)
      options.date.push(candidate(region, date) as Candidate<never>);
    if (method)
      options.paymentMethod.push(candidate(region, method) as Candidate<never>);
    if (/\bSUB\s*TOTAL\b/.test(upper)) {
      flush();
      summary = true;
      if (amount !== null)
        options.subtotalMinor.push(
          candidate(region, amount) as Candidate<never>,
        );
      continue;
    }
    if (/\bIVA\b|\bIMPUESTO\b/.test(upper)) {
      flush();
      summary = true;
      if (amount !== null && !/\d+\s*%/.test(region.text))
        options.taxMinor.push(candidate(region, amount) as Candidate<never>);
      continue;
    }
    if (/^\s*(?:TOTAL|IMPORTE TOTAL)\b/.test(upper)) {
      flush();
      summary = true;
      if (amount !== null)
        options.totalMinor.push(candidate(region, amount) as Candidate<never>);
      else {
        const split = splitLabelAmount(regions, region);
        if (split) options.totalMinor.push(split as Candidate<never>);
      }
      continue;
    }
    if (
      !options.merchant.length &&
      !date &&
      !method &&
      !unit &&
      amount === null &&
      /[A-ZÁÉÍÓÚÑ]/i.test(region.text) &&
      upper.length > 3
    )
      options.merchant.push(candidate(region, region.text) as Candidate<never>);
    if (
      summary ||
      date ||
      method ||
      unit ||
      options.merchant[0]?.exact === region.text
    )
      continue;
    const foundQuantity = quantity(region.text);
    if (foundQuantity && current) {
      current.quantity = candidate(region, foundQuantity.value);
      current.unit = foundQuantity.unit;
      continue;
    }
    if (
      !foundQuantity &&
      /[A-ZÁÉÍÓÚÑ]{3}/i.test(region.text) &&
      !/[$€]|\b(?:PRECIO|IMPORTE|TOTAL)\b/.test(upper)
    ) {
      flush();
      current = {
        description: candidate(region, region.text),
        quantity: null,
        unit: null,
        unitPriceMinor: null,
        discountMinor: null,
        lineTotalMinor: null,
      };
      continue;
    }
    if (/DESCUENTO|DTO\b/.test(upper) && current && amount !== null) {
      current.discountMinor = candidate(region, amount);
      continue;
    }
    if (amount !== null && current) {
      const parsed = candidate(region, amount);
      if (current.lineTotalMinor && !current.unitPriceMinor) {
        current.unitPriceMinor = current.lineTotalMinor;
      }
      current.lineTotalMinor = parsed;
      continue;
    }
    if (
      amount === null &&
      /[A-ZÁÉÍÓÚÑ]/i.test(region.text) &&
      upper.length > 2
    ) {
      flush();
      current = {
        description: candidate(region, region.text),
        quantity: null,
        unit: null,
        unitPriceMinor: null,
        discountMinor: null,
        lineTotalMinor: null,
      };
    }
  }
  flush();
  const spatialItems = layoutItems(regions);
  if (spatialItems) lineItems.splice(0, lineItems.length, ...spatialItems);
  const fields: ProposalFields = {
    merchant: options.merchant[0] ?? null,
    date: options.date[0] ?? null,
    totalMinor: options.totalMinor[0] ?? null,
    currency: options.currency[0] ?? null,
    subtotalMinor: options.subtotalMinor[0] ?? null,
    taxMinor: options.taxMinor[0] ?? null,
    paymentMethod: options.paymentMethod[0] ?? null,
  };
  const conflicts: Proposal["conflicts"] = [];
  for (const [name, values] of Object.entries(options)) {
    if (values.some((value) => value.normalized !== values[0]?.normalized))
      conflicts.push({
        field: name as keyof ProposalFields,
        alternatives: values as Candidate<string | number>[],
      });
  }
  const warnings = [
    ...Object.entries(fields)
      .filter(([, value]) => value === null)
      .map(
        ([name]) => `MISSING_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
      ),
    ...(lineItems.length ? [] : ["LINE_ITEMS_UNAVAILABLE"]),
    ...(lineItems.some((line) => line.lineTotalMinor === null)
      ? ["LINE_ITEMS_INCOMPLETE"]
      : []),
    ...(fields.totalMinor &&
    lineItems.length > 0 &&
    lineItems.every((line) => line.lineTotalMinor !== null) &&
    lineItems.reduce(
      (sum, line) => sum + line.lineTotalMinor!.normalized,
      0,
    ) !== fields.totalMinor.normalized
      ? ["LINE_TOTAL_MISMATCH"]
      : []),
    ...(conflicts.length ? ["FIELD_CONFLICT"] : []),
  ];
  return { version: 1, fields, lineItems, conflicts, warnings };
}
