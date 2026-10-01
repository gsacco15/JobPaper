import type { DocType, JobDocument } from "../shared/document.js";
import { forStorage } from "../shared/files.js";
import { normalizeDocument } from "../shared/normalize.js";
import { formatMoney } from "../shared/totals.js";

// A per-device convenience list for the sidebar home. ChatGPT's files remain
// the real record; this may be empty (private window, cleared storage).

const KEY = "jobpaper.recent.v1";
const MAX = 12;

export interface RecentDoc {
  doc_id: string;
  doc_type: DocType;
  title: string;
  date: string;
  total_text: string;
  doc: JobDocument;
}

export function loadRecent(): RecentDoc[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({ ...r, doc: normalizeDocument(r?.doc) }))
      .filter((r): r is RecentDoc => !!r.doc);
  } catch {
    return [];
  }
}

export function rememberDoc(doc: JobDocument): void {
  try {
    const total =
      doc.doc_type === "change_order" && doc.change
        ? formatMoney(doc.change.new_total)
        : doc.doc_type === "estimate"
          ? formatMoney(doc.totals.total)
          : `${doc.photos.length} photos`;
    const entry: RecentDoc = { doc_id: doc.doc_id, doc_type: doc.doc_type, title: doc.title, date: doc.date, total_text: total, doc: forStorage(doc) };
    const list = [entry, ...loadRecent().filter((r) => r.doc_id !== doc.doc_id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable; fine
  }
}
