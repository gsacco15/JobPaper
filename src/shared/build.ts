import {
  DEFAULT_VALID_DAYS,
  type JobDocument,
  type LineItem,
  type Photo,
} from "./document.js";
import { isoDate, newDocId } from "./ids.js";
import { normalizeLineItems, normalizePhotos } from "./normalize.js";
import { businessFromSettings, settingsHints, type BusinessSettings } from "./settings.js";
import { contractItemsAfter, recompute, roundMoney, safeNumber } from "./totals.js";

// Builders turn tool inputs + business settings into finished documents.
// All math happens here (via recompute), never in the model.

export interface BuildContext {
  settings: BusinessSettings;
  /** YYYY-MM-DD; defaults to today in timeZone. */
  date?: string;
  timeZone?: string;
}

export interface EstimateInput {
  job_description: string;
  line_items?: Array<Partial<LineItem>>;
  client_name?: string;
  job_address_text?: string;
  notes?: string;
  title?: string;
}

export interface ChangeOrderInput {
  change_description: string;
  added_items?: Array<Partial<LineItem>>;
  removed_item_ids?: string[];
  schedule_impact_days?: number;
}

export interface JobReportInput {
  job_name: string;
  period?: "daily" | "weekly";
  notes: string;
  photos?: Array<string | Partial<Photo>>;
  crew_count?: number;
  hours?: number;
  weather_text?: string;
  issues?: string;
  next_steps?: string;
}

const s = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** "Bathroom remodel — Henderson" from the description and client. */
export function deriveTitle(description: string, clientName: string): string {
  let base = description
    .split(/[\n.!?;:]/)[0]!
    .replace(/^(please\s+)?(write up|put together|price out|make|create|draft|need|give me)\s+(an?\s+)?(estimate|quote|bid|price)?\s*(for|on)?\s*(an?|the)?\s*/i, "")
    // Keep the job, drop the details: "6 ft cedar fence, 120 ft, for the Lees" -> "6 ft cedar fence"
    .split(",")[0]!
    .replace(/\s+(for|at)\s+(the\s+)?[A-Z][\w'’.-]*(\s+[A-Z][\w'’.-]*)*\s*$/, "")
    .trim();
  if (base.length > 60) base = base.slice(0, 57).replace(/\s+\S*$/, "") + "…";
  if (!base) base = "Job";
  base = base[0]!.toUpperCase() + base.slice(1);
  const last = clientName.trim().split(/\s+/).pop();
  return last ? `${base} — ${last}` : base;
}

function today(ctx: BuildContext): string {
  return ctx.date ?? isoDate(new Date(), ctx.timeZone);
}

function baseDoc(ctx: BuildContext, type: JobDocument["doc_type"]): JobDocument {
  const date = today(ctx);
  return {
    doc_type: type,
    doc_id: newDocId(type, date),
    business: businessFromSettings(ctx.settings),
    client: { name: "", address_text: "" },
    title: "",
    date,
    valid_days: DEFAULT_VALID_DAYS,
    line_items: [],
    totals: {
      subtotal: 0,
      markup_pct: ctx.settings.default_markup_pct,
      markup: 0,
      tax_pct: ctx.settings.default_tax_pct,
      tax: 0,
      total: 0,
    },
    notes: "",
    terms: ctx.settings.default_terms,
    references: { estimate_id: null },
    photos: [],
    hints: settingsHints(ctx.settings),
    version: 1,
  };
}

export function buildEstimate(input: EstimateInput, ctx: BuildContext): JobDocument {
  const doc = baseDoc(ctx, "estimate");
  const clientName = s(input.client_name, 120);
  doc.client = { name: clientName, address_text: s(input.job_address_text, 300) };
  doc.title = s(input.title, 160) || deriveTitle(s(input.job_description, 3000), clientName);
  doc.line_items = normalizeLineItems(input.line_items);
  doc.notes = s(input.notes, 5000);
  return recompute(doc);
}

/** Matches a removal reference by line id, or by exact (case-insensitive) name. */
function resolveRemovals(refs: string[] | undefined, prior: LineItem[]): string[] {
  const out = new Set<string>();
  for (const ref of refs ?? []) {
    if (typeof ref !== "string") continue;
    const key = ref.trim().toLowerCase();
    const hit = prior.find((l) => l.id.toLowerCase() === key) ?? prior.find((l) => l.name.toLowerCase() === key);
    if (hit) out.add(hit.id);
  }
  return [...out];
}

export const CHANGE_ORDER_TERMS =
  "This change order adjusts the contract total shown. Work on these changes begins after approval.";

/**
 * Build a change order from the estimate it modifies — or from the latest
 * change order on that estimate, so CO-2 starts from CO-1's new total.
 */
export function buildChangeOrder(
  source: JobDocument,
  input: ChangeOrderInput,
  ctx: BuildContext,
  sourceUri?: string,
): JobDocument {
  if (source.doc_type === "job_report") {
    throw new Error("A change order has to start from an estimate (or an earlier change order), not a job report.");
  }
  const doc = baseDoc(ctx, "change_order");
  const fromCo = source.doc_type === "change_order" && source.change;
  const prior = fromCo ? contractItemsAfter(source) : source.line_items;
  const sequence = fromCo ? source.change!.sequence + 1 : 1;
  const originalTotal = fromCo ? source.change!.original_total : source.totals.total;
  const previousTotal = fromCo ? source.change!.new_total : source.totals.total;
  const description = s(input.change_description, 3000);

  doc.client = { ...source.client };
  doc.title = `CO-${sequence} · ${source.title.replace(/^CO-\d+\s*·\s*/, "")}`;
  // The change order uses the contract's markup and tax so the math lines up.
  doc.totals.markup_pct = source.totals.markup_pct;
  doc.totals.tax_pct = source.totals.tax_pct;
  doc.terms = CHANGE_ORDER_TERMS;
  doc.notes = "";
  doc.hints = (doc.hints ?? []).filter((h) => !h.startsWith("Markup and tax"));
  doc.references = {
    estimate_id: fromCo ? source.references.estimate_id : source.doc_id,
    source_uri: sourceUri ?? null,
    previous_change_order_id: fromCo ? source.doc_id : null,
  };
  doc.line_items = normalizeLineItems(input.added_items, prior.map((l) => l.id));
  doc.change = {
    sequence,
    change_description: description,
    original_total: roundMoney(originalTotal),
    previous_total: roundMoney(previousTotal),
    prior_items: prior.map((l) => ({ ...l })),
    removed_ids: resolveRemovals(input.removed_item_ids, prior),
    net_change: 0,
    new_total: 0,
    schedule_impact_days: Math.round(safeNumber(input.schedule_impact_days, 0)),
  };
  return recompute(doc);
}

/** Keep the user's order, but put photos of the same area next to each other. */
export function groupPhotosByArea(photos: Photo[]): Photo[] {
  const order: string[] = [];
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    const key = p.area.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(p);
  }
  return order.flatMap((k) => groups.get(k)!);
}

export function buildJobReport(input: JobReportInput, ctx: BuildContext): JobDocument {
  const doc = baseDoc(ctx, "job_report");
  const period = input.period === "weekly" ? "weekly" : "daily";
  const jobName = s(input.job_name, 120) || "Job";
  doc.title = `${jobName} — ${period === "weekly" ? "Weekly" : "Daily"} Report`;
  doc.terms = "";
  doc.valid_days = 0;
  doc.hints = (doc.hints ?? []).filter((h) => !h.startsWith("Markup and tax"));
  doc.photos = groupPhotosByArea(normalizePhotos(input.photos));
  const num = (v: unknown) => (v === undefined || v === null ? null : Math.max(0, safeNumber(v, 0)));
  doc.report = {
    period,
    crew_count: num(input.crew_count),
    hours: num(input.hours),
    weather_text: s(input.weather_text, 200),
    work_done: s(input.notes, 5000),
    issues: s(input.issues, 3000),
    next_steps: s(input.next_steps, 3000),
  };
  return recompute(doc);
}
