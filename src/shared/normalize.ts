import {
  DEFAULT_TERMS,
  DEFAULT_VALID_DAYS,
  emptyBusiness,
  type ChangeSummary,
  type DocType,
  type JobDocument,
  type JobReport,
  type LineItem,
  type Photo,
} from "./document.js";
import { assignLineIds } from "./ids.js";
import { clampPct, recompute, roundMoney, safeNumber } from "./totals.js";

// Normalizers turn untrusted JSON (model input, a file opened weeks later, a
// hand-edited file) into a well-formed document. They never throw.

const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";

const UNIT_ALIASES: Record<string, string> = {
  job: "job",
  "lump sum": "job",
  ls: "job",
  lot: "job",
  hr: "hr",
  hrs: "hr",
  hour: "hr",
  hours: "hr",
  "sq ft": "sq ft",
  sqft: "sq ft",
  sf: "sq ft",
  "square feet": "sq ft",
  "square foot": "sq ft",
  "ln ft": "ln ft",
  lf: "ln ft",
  "linear feet": "ln ft",
  "linear foot": "ln ft",
  "lin ft": "ln ft",
  each: "each",
  ea: "each",
  pc: "each",
  pcs: "each",
  unit: "each",
  units: "each",
};

export function normalizeUnit(unit: unknown): string {
  const raw = str(unit, 20).toLowerCase().replace(/\.$/, "");
  if (!raw) return "job";
  return UNIT_ALIASES[raw] ?? raw;
}

export function normalizeLineItems(raw: unknown, reservedIds: Iterable<string> = []): LineItem[] {
  const list = Array.isArray(raw) ? raw.slice(0, 100) : [];
  const items = list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: typeof x.id === "string" ? x.id : undefined,
      name: str(x.name ?? x.description, 300),
      qty: Math.max(0, safeNumber(x.qty ?? x.quantity, 1)),
      unit: normalizeUnit(x.unit),
      unit_price: roundMoney(safeNumber(x.unit_price ?? x.price ?? x.rate, 0)),
    }))
    .filter((x) => x.name.length > 0);
  const ids = assignLineIds(items, reservedIds);
  return items.map((item, i) => ({ ...item, id: ids[i]! }));
}

export function normalizePhotos(raw: unknown): Photo[] {
  const list = Array.isArray(raw) ? raw.slice(0, 40) : [];
  return list
    .map((p): Photo | null => {
      if (typeof p === "string") return p.trim() ? { uri: p.trim(), caption: "", area: "" } : null;
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        const uri = str(o.uri ?? o.url ?? o.resourceUri, 100_000);
        if (!uri) return null;
        return { uri, caption: str(o.caption, 300), area: str(o.area, 80) };
      }
      return null;
    })
    .filter((p): p is Photo => p !== null);
}

function normalizeReport(raw: unknown): JobReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.max(0, safeNumber(v, 0)));
  return {
    period: r.period === "weekly" ? "weekly" : "daily",
    crew_count: n(r.crew_count),
    hours: n(r.hours),
    weather_text: str(r.weather_text, 200),
    work_done: str(r.work_done, 5000),
    issues: str(r.issues, 3000),
    next_steps: str(r.next_steps, 3000),
  };
}

function normalizeChange(raw: unknown): ChangeSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const prior = normalizeLineItems(c.prior_items);
  const priorIds = new Set(prior.map((l) => l.id));
  return {
    sequence: Math.max(1, Math.round(safeNumber(c.sequence, 1))),
    change_description: str(c.change_description, 3000),
    original_total: roundMoney(safeNumber(c.original_total)),
    previous_total: roundMoney(safeNumber(c.previous_total)),
    prior_items: prior,
    removed_ids: Array.isArray(c.removed_ids)
      ? [...new Set(c.removed_ids.filter((id): id is string => typeof id === "string" && priorIds.has(id)))]
      : [],
    net_change: roundMoney(safeNumber(c.net_change)),
    new_total: roundMoney(safeNumber(c.new_total)),
    schedule_impact_days: Math.round(safeNumber(c.schedule_impact_days, 0)),
  };
}

const DOC_TYPES: DocType[] = ["estimate", "change_order", "job_report"];

/** Parse any JSON-ish value into a document, or null when it clearly isn't one. */
export function normalizeDocument(raw: unknown): JobDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const doc_type = DOC_TYPES.includes(d.doc_type as DocType) ? (d.doc_type as DocType) : null;
  if (!doc_type) return null;
  const business = (d.business && typeof d.business === "object" ? d.business : {}) as Record<string, unknown>;
  const client = (d.client && typeof d.client === "object" ? d.client : {}) as Record<string, unknown>;
  const totals = (d.totals && typeof d.totals === "object" ? d.totals : {}) as Record<string, unknown>;
  const refs = (d.references && typeof d.references === "object" ? d.references : {}) as Record<string, unknown>;
  const change = doc_type === "change_order" ? normalizeChange(d.change) : undefined;
  // Added lines on a change order must not reuse ids from the prior contract.
  const line_items = normalizeLineItems(d.line_items, change?.prior_items.map((l) => l.id) ?? []);
  const doc: JobDocument = {
    doc_type,
    doc_id: str(d.doc_id, 80) || `${doc_type}_unknown`,
    business: {
      ...emptyBusiness(),
      name: str(business.name, 120),
      phone: str(business.phone, 40),
      email: str(business.email, 120),
      logo_data_url: str(business.logo_data_url, 400_000),
    },
    client: { name: str(client.name, 120), address_text: str(client.address_text, 300) },
    title: str(d.title, 160) || "Untitled",
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(d.date)) ? str(d.date) : new Date().toISOString().slice(0, 10),
    valid_days: Math.max(0, Math.round(safeNumber(d.valid_days, DEFAULT_VALID_DAYS))),
    line_items,
    totals: {
      subtotal: 0,
      markup_pct: clampPct(totals.markup_pct),
      markup: 0,
      tax_pct: clampPct(totals.tax_pct),
      tax: 0,
      total: 0,
    },
    notes: str(d.notes, 5000),
    terms: typeof d.terms === "string" ? str(d.terms, 2000) : DEFAULT_TERMS,
    references: {
      estimate_id: str(refs.estimate_id, 80) || null,
      source_uri: str(refs.source_uri, 100_000) || null,
      previous_change_order_id: str(refs.previous_change_order_id, 80) || null,
    },
    photos: normalizePhotos(d.photos),
    hints: Array.isArray(d.hints) ? d.hints.map((h) => str(h, 200)).filter(Boolean).slice(0, 5) : [],
    version: 1,
  };
  if (doc_type === "change_order") {
    doc.change = change ?? {
      sequence: 1,
      change_description: "",
      original_total: 0,
      previous_total: 0,
      prior_items: [],
      removed_ids: [],
      net_change: 0,
      new_total: 0,
      schedule_impact_days: 0,
    };
  }
  if (doc_type === "job_report") {
    doc.report = normalizeReport(d.report) ?? normalizeReport({})!;
  }
  return recompute(doc);
}

export function parseDocumentText(text: string): JobDocument | null {
  try {
    return normalizeDocument(JSON.parse(text));
  } catch {
    return null;
  }
}
