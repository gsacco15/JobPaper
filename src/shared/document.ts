// The one document shape shared by estimates, change orders, and job reports.
// The server builds it, the panel edits it, and it is saved into the chat as
// a small JSON file (<title>.est.json / .co.json / .rpt.json).

export type DocType = "estimate" | "change_order" | "job_report";

export const UNITS = ["job", "hr", "sq ft", "ln ft", "each"] as const;
export type Unit = (typeof UNITS)[number];

export interface LineItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  unit_price: number;
}

export interface Business {
  name: string;
  phone: string;
  email: string;
  logo_data_url: string;
}

export interface Client {
  name: string;
  address_text: string;
}

export interface Totals {
  subtotal: number;
  markup_pct: number;
  markup: number;
  tax_pct: number;
  tax: number;
  total: number;
}

export interface References {
  /** Original estimate this change order belongs to. */
  estimate_id: string | null;
  /** Resource URI of the original estimate file (opens with "Open original estimate"). */
  source_uri?: string | null;
  /** Change order this one follows, when chained (CO-2 follows CO-1). */
  previous_change_order_id?: string | null;
}

export interface ChangeSummary {
  /** CO-1, CO-2, ... per estimate. */
  sequence: number;
  change_description: string;
  /** Total of the original estimate, read from the file. */
  original_total: number;
  /** Contract total before this change order. */
  previous_total: number;
  /** Contract lines before this change order (read from the source file). */
  prior_items: LineItem[];
  /** Ids of prior_items this change order removes. */
  removed_ids: string[];
  /** Net change including markup and tax. */
  net_change: number;
  new_total: number;
  schedule_impact_days: number;
}

export interface Photo {
  uri: string;
  caption: string;
  area: string;
}

export interface JobReport {
  period: "daily" | "weekly";
  crew_count: number | null;
  hours: number | null;
  weather_text: string;
  work_done: string;
  issues: string;
  next_steps: string;
}

export interface JobDocument {
  doc_type: DocType;
  doc_id: string;
  business: Business;
  client: Client;
  title: string;
  date: string;
  valid_days: number;
  /** For a change order these are the added lines. */
  line_items: LineItem[];
  totals: Totals;
  notes: string;
  terms: string;
  references: References;
  photos: Photo[];
  change?: ChangeSummary;
  report?: JobReport;
  /** One-line hints the panel shows (for example "Set your tax rate in settings"). */
  hints?: string[];
  version: 1;
}

export const DOC_EXTENSIONS: Record<DocType, string> = {
  estimate: ".est.json",
  change_order: ".co.json",
  job_report: ".rpt.json",
};

export const DOC_LABELS: Record<DocType, string> = {
  estimate: "Estimate",
  change_order: "Change Order",
  job_report: "Job Report",
};

export const DEFAULT_TERMS = "50% deposit to schedule, balance on completion.";
export const DEFAULT_VALID_DAYS = 30;

export function emptyBusiness(): Business {
  return { name: "", phone: "", email: "", logo_data_url: "" };
}
