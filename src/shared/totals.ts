import type { ChangeSummary, JobDocument, LineItem, Totals } from "./document.js";

/** Round to cents without floating-point drift (1.005 -> 1.01). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clampPct(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function lineTotal(item: Pick<LineItem, "qty" | "unit_price">): number {
  return roundMoney(safeNumber(item.qty) * safeNumber(item.unit_price));
}

export function sumLines(items: LineItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + lineTotal(item), 0));
}

/** Subtotal -> markup -> tax (on subtotal + markup) -> total. */
export function computeTotals(
  subtotal: number,
  markupPct: number,
  taxPct: number,
): Totals {
  const markup_pct = clampPct(markupPct);
  const tax_pct = clampPct(taxPct);
  const sub = roundMoney(subtotal);
  const markup = roundMoney((sub * markup_pct) / 100);
  const tax = roundMoney(((sub + markup) * tax_pct) / 100);
  return {
    subtotal: sub,
    markup_pct,
    markup,
    tax_pct,
    tax,
    total: roundMoney(sub + markup + tax),
  };
}

export function totalsForItems(
  items: LineItem[],
  markupPct: number,
  taxPct: number,
): Totals {
  return computeTotals(sumLines(items), markupPct, taxPct);
}

/**
 * Recompute everything derived from the editable fields. The panel calls this
 * after every edit; the server calls it before returning a document.
 */
export function recompute(doc: JobDocument): JobDocument {
  if (doc.doc_type === "job_report") {
    return {
      ...doc,
      totals: totalsForItems(doc.line_items, doc.totals.markup_pct, doc.totals.tax_pct),
    };
  }
  if (doc.doc_type === "change_order" && doc.change) {
    const added = sumLines(doc.line_items);
    const removed = sumLines(removedItems(doc.change));
    const totals = computeTotals(added - removed, doc.totals.markup_pct, doc.totals.tax_pct);
    const change: ChangeSummary = {
      ...doc.change,
      net_change: totals.total,
      new_total: roundMoney(doc.change.previous_total + totals.total),
    };
    return { ...doc, totals, change };
  }
  return {
    ...doc,
    totals: totalsForItems(doc.line_items, doc.totals.markup_pct, doc.totals.tax_pct),
  };
}

/** "50% deposit to schedule" -> 50. Returns null when the terms name no deposit. */
export function depositPct(terms: string): number | null {
  const match = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:deposit|down|up\s*front)/i.exec(terms);
  if (!match) return null;
  const pct = Number(match[1]);
  return pct > 0 && pct <= 100 ? pct : null;
}

export function formatMoney(value: number, withCents?: boolean): string {
  const v = roundMoney(value);
  const cents = withCents ?? !Number.isInteger(v);
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return (v < 0 ? "-$" : "$") + abs;
}

export function formatSignedMoney(value: number): string {
  const v = roundMoney(value);
  return (v > 0 ? "+" : "") + formatMoney(v);
}

export function formatQty(qty: number): string {
  const v = Math.round(safeNumber(qty) * 100) / 100;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function removedItems(change: ChangeSummary): LineItem[] {
  const ids = new Set(change.removed_ids);
  return change.prior_items.filter((l) => ids.has(l.id));
}

/** Contract lines after a change order: prior lines not removed, plus added lines. */
export function contractItemsAfter(doc: JobDocument): LineItem[] {
  if (doc.doc_type !== "change_order" || !doc.change) return doc.line_items;
  const ids = new Set(doc.change.removed_ids);
  return [...doc.change.prior_items.filter((l) => !ids.has(l.id)), ...doc.line_items];
}
