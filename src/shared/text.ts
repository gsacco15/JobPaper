import { DOC_LABELS, type JobDocument } from "./document.js";
import { depositPct, formatMoney, formatQty, formatSignedMoney, lineTotal, removedItems } from "./totals.js";

/**
 * Short SMS-friendly version: title, 3–6 lines, total, deposit, phone.
 */
export function toSmsText(doc: JobDocument): string {
  const out: string[] = [];
  const who = doc.business.name ? `${doc.business.name} — ` : "";
  out.push(`${who}${DOC_LABELS[doc.doc_type]}: ${doc.title}`);

  if (doc.doc_type === "job_report" && doc.report) {
    const r = doc.report;
    const meta = [
      r.crew_count ? `${formatQty(r.crew_count)} crew` : "",
      r.hours ? `${formatQty(r.hours)} hrs` : "",
      r.weather_text,
    ].filter(Boolean);
    if (meta.length) out.push(meta.join(" · "));
    if (r.work_done) out.push(clip(r.work_done, 280));
    if (r.issues) out.push(`Issues: ${clip(r.issues, 160)}`);
    if (r.next_steps) out.push(`Next: ${clip(r.next_steps, 160)}`);
    if (doc.photos.length) out.push(`${doc.photos.length} photo${doc.photos.length === 1 ? "" : "s"} in the PDF`);
  } else {
    const items =
      doc.doc_type === "change_order" && doc.change
        ? [
            ...doc.line_items.map((l) => `+ ${l.name}: ${formatMoney(lineTotal(l))}`),
            ...removedItems(doc.change).map((l) => `− ${l.name}: ${formatMoney(-lineTotal(l))}`),
          ]
        : doc.line_items.map((l) => `• ${l.name}: ${formatMoney(lineTotal(l))}`);
    const shown = items.slice(0, 6);
    out.push(...shown);
    if (items.length > shown.length) out.push(`…and ${items.length - shown.length} more`);

    if (doc.doc_type === "change_order" && doc.change) {
      out.push(`Change: ${formatSignedMoney(doc.change.net_change)}`);
      out.push(`New contract total: ${formatMoney(doc.change.new_total)}`);
      if (doc.change.schedule_impact_days) {
        const d = doc.change.schedule_impact_days;
        out.push(`Schedule: ${d > 0 ? "+" : ""}${d} day${Math.abs(d) === 1 ? "" : "s"}`);
      }
    } else {
      out.push(`Total: ${formatMoney(doc.totals.total)}`);
      const pct = depositPct(doc.terms);
      if (pct) out.push(`Deposit to schedule: ${formatMoney((doc.totals.total * pct) / 100)} (${pct}%)`);
    }
  }
  if (doc.business.phone) out.push(`Questions? ${doc.business.phone}`);
  return out.join("\n");
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}

/** One-line summary for the model after the panel renders or after an edit. */
export function modelSummary(doc: JobDocument): string {
  const label = DOC_LABELS[doc.doc_type];
  if (doc.doc_type === "job_report") {
    return `${label} "${doc.title}" (${doc.doc_id}) with ${doc.photos.length} photo(s).`;
  }
  const lines = doc.line_items
    .map((l) => `${l.id} ${l.name}: ${formatQty(l.qty)} ${l.unit} × ${formatMoney(l.unit_price)} = ${formatMoney(lineTotal(l))}`)
    .join("; ");
  const t = doc.totals;
  const totals = `subtotal ${formatMoney(t.subtotal)}, markup ${t.markup_pct}% (${formatMoney(t.markup)}), tax ${t.tax_pct}% (${formatMoney(t.tax)}), total ${formatMoney(t.total)}`;
  if (doc.doc_type === "change_order" && doc.change) {
    const c = doc.change;
    const removed = removedItems(c).map((l) => `${l.id} ${l.name}`).join("; ");
    return `${label} CO-${c.sequence} "${doc.title}" (${doc.doc_id}) for estimate ${doc.references.estimate_id}. Added: ${lines || "none"}. Removed: ${removed || "none"}. Net change ${formatSignedMoney(c.net_change)} (${totals}). Original total ${formatMoney(c.original_total)}, previous total ${formatMoney(c.previous_total)}, new contract total ${formatMoney(c.new_total)}. Schedule impact ${c.schedule_impact_days} day(s).`;
  }
  return `${label} "${doc.title}" (${doc.doc_id}). Lines: ${lines || "none"}. Totals: ${totals}.`;
}
