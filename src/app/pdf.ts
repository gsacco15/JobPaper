import { jsPDF } from "jspdf";
import { DOC_LABELS, type JobDocument } from "../shared/document.js";
import {
  depositPct,
  formatMoney,
  formatQty,
  formatSignedMoney,
  lineTotal,
  removedItems,
} from "../shared/totals.js";

// The PDF is built entirely on the device. Nothing is sent to a server.

export interface PdfImages {
  /** Logo as a PNG/JPEG data URL. */
  logo?: string | null;
  /** Photo uri -> JPEG data URL (already downsized by the panel). */
  photos?: Record<string, string | null>;
}

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const M = 48; // margin
const CONTENT_W = PAGE_W - M * 2;
const INK = [26, 28, 31] as const;
const MUTED = [110, 114, 120] as const;
const RULE = [222, 224, 228] as const;

/** Standard PDF fonts only cover WinAnsi; swap the few characters that aren't. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[−‐-‒]/g, "-")
    .replace(/[✓✔]/g, "v")
    .replace(/ /g, " ")
    .replace(/[^\u0000-ÿ–—‘’“”•…€™]/g, "");
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function imageFormat(dataUrl: string): string {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

class Writer {
  readonly pdf = new jsPDF({ unit: "pt", format: "letter" });
  y = M;

  ensure(height: number) {
    if (this.y + height > PAGE_H - M - 20) {
      this.pdf.addPage();
      this.y = M;
    }
  }

  font(size: number, style: "normal" | "bold" = "normal", color: readonly number[] = INK) {
    this.pdf.setFont("helvetica", style);
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(color[0]!, color[1]!, color[2]!);
  }

  text(text: string, x: number, y: number, opts?: { align?: "left" | "right" | "center" }) {
    this.pdf.text(pdfSafe(text), x, y, opts);
  }

  wrap(text: string, width: number): string[] {
    return this.pdf.splitTextToSize(pdfSafe(text), width) as string[];
  }

  rule(y = this.y, color: readonly number[] = RULE) {
    this.pdf.setDrawColor(color[0]!, color[1]!, color[2]!);
    this.pdf.setLineWidth(0.75);
    this.pdf.line(M, y, PAGE_W - M, y);
  }

  /** A labeled paragraph block that flows across pages. */
  section(label: string, body: string) {
    if (!body.trim()) return;
    this.ensure(40);
    this.font(9, "bold", MUTED);
    this.text(label.toUpperCase(), M, this.y);
    this.y += 14;
    this.font(10.5);
    for (const para of body.split(/\n+/)) {
      for (const line of this.wrap(para, CONTENT_W)) {
        this.ensure(15);
        this.text(line, M, this.y);
        this.y += 14.5;
      }
      this.y += 3;
    }
    this.y += 10;
  }
}

function header(w: Writer, doc: JobDocument, images: PdfImages) {
  const { pdf } = w;
  let left = M;
  const logo = images.logo ?? (doc.business.logo_data_url || null);
  if (logo) {
    try {
      const props = pdf.getImageProperties(logo);
      const ratio = props.width / props.height;
      const width = Math.min(120, ratio * 48);
      pdf.addImage(logo, imageFormat(logo), M, M - 6, width, width / ratio);
      left = M + width + 12;
    } catch {
      // A broken logo never blocks the PDF.
    }
  }
  w.font(15, "bold");
  w.text(doc.business.name || "Your Business", left, M + 8);
  w.font(10, "normal", MUTED);
  const contact = [doc.business.phone, doc.business.email].filter(Boolean);
  contact.forEach((line, i) => w.text(line, left, M + 24 + i * 13));

  const right = PAGE_W - M;
  w.font(18, "bold");
  w.text(DOC_LABELS[doc.doc_type].toUpperCase(), right, M + 8, { align: "right" });
  w.font(10, "normal", MUTED);
  const meta = [longDate(doc.date)];
  if (doc.doc_type === "change_order" && doc.change) meta.unshift(`CO-${doc.change.sequence}`);
  else meta.push(`No. ${doc.doc_id.split("_").pop()!.toUpperCase()}`);
  if (doc.doc_type === "estimate" && doc.valid_days > 0) meta.push(`Valid until ${longDate(addDays(doc.date, doc.valid_days))}`);
  meta.forEach((line, i) => w.text(line, right, M + 24 + i * 13, { align: "right" }));

  w.y = M + 24 + Math.max(contact.length, meta.length) * 13 + 14;
  w.rule();
  w.y += 22;
}

function clientAndTitle(w: Writer, doc: JobDocument) {
  if (doc.client.name || doc.client.address_text) {
    w.font(9, "bold", MUTED);
    w.text(doc.doc_type === "job_report" ? "PREPARED FOR" : "CLIENT", M, w.y);
    w.y += 14;
    w.font(11);
    if (doc.client.name) {
      w.text(doc.client.name, M, w.y);
      w.y += 14;
    }
    for (const line of doc.client.address_text ? w.wrap(doc.client.address_text, CONTENT_W / 2) : []) {
      w.font(10.5, "normal", MUTED);
      w.text(line, M, w.y);
      w.y += 13.5;
    }
    w.y += 10;
  }
  w.font(14, "bold");
  for (const line of w.wrap(doc.title, CONTENT_W)) {
    w.text(line, M, w.y);
    w.y += 18;
  }
  w.y += 8;
}

const COLS = {
  name: M,
  qty: M + CONTENT_W - 230,
  unit: M + CONTENT_W - 190,
  price: M + CONTENT_W - 80,
  total: M + CONTENT_W,
};

function itemsTable(w: Writer, title: string, items: JobDocument["line_items"], sign: 1 | -1 = 1) {
  if (!items.length) return;
  w.ensure(50);
  w.font(9, "bold", MUTED);
  w.text(title.toUpperCase(), COLS.name, w.y);
  w.text("QTY", COLS.qty, w.y, { align: "right" });
  w.text("UNIT", COLS.unit, w.y);
  w.text("PRICE", COLS.price, w.y, { align: "right" });
  w.text("AMOUNT", COLS.total, w.y, { align: "right" });
  w.y += 7;
  w.rule();
  w.y += 15;
  for (const item of items) {
    const lines = w.wrap(item.name, COLS.qty - COLS.name - 40);
    w.ensure(lines.length * 14 + 10);
    w.font(10.5);
    lines.forEach((line, i) => w.text(line, COLS.name, w.y + i * 14));
    w.text(formatQty(item.qty), COLS.qty, w.y, { align: "right" });
    w.font(10.5, "normal", MUTED);
    w.text(item.unit, COLS.unit, w.y);
    w.font(10.5);
    w.text(formatMoney(item.unit_price), COLS.price, w.y, { align: "right" });
    w.text(formatMoney(sign * lineTotal(item)), COLS.total, w.y, { align: "right" });
    w.y += lines.length * 14 + 6;
    w.rule(w.y - 4, [238, 239, 241]);
    w.y += 6;
  }
  w.y += 4;
}

function totalsBlock(w: Writer, rows: Array<[string, string, boolean?]>) {
  w.ensure(rows.length * 17 + 20);
  const labelX = PAGE_W - M - 190;
  for (const [label, value, strong] of rows) {
    if (strong) {
      w.pdf.setDrawColor(INK[0], INK[1], INK[2]);
      w.pdf.setLineWidth(1);
      w.pdf.line(labelX, w.y - 11, PAGE_W - M, w.y - 11);
      w.y += 4;
    }
    w.font(strong ? 12 : 10.5, strong ? "bold" : "normal", strong ? INK : MUTED);
    w.text(label, labelX, w.y);
    w.font(strong ? 12 : 10.5, strong ? "bold" : "normal");
    w.text(value, PAGE_W - M, w.y, { align: "right" });
    w.y += strong ? 20 : 16;
  }
  w.y += 14;
}

function moneyRows(doc: JobDocument, totalLabel: string): Array<[string, string, boolean?]> {
  const t = doc.totals;
  const rows: Array<[string, string, boolean?]> = [["Subtotal", formatMoney(t.subtotal, true)]];
  if (t.markup_pct) rows.push([`Markup (${t.markup_pct}%)`, formatMoney(t.markup, true)]);
  if (t.tax_pct) rows.push([`Tax (${t.tax_pct}%)`, formatMoney(t.tax, true)]);
  rows.push([totalLabel, formatMoney(t.total, true), true]);
  return rows;
}

async function photoGrid(w: Writer, doc: JobDocument, images: PdfImages) {
  if (!doc.photos.length) return;
  w.ensure(40);
  w.font(9, "bold", MUTED);
  w.text("PHOTOS", M, w.y);
  w.y += 12;
  const gap = 16;
  const cellW = (CONTENT_W - gap) / 2;
  const imgH = cellW * 0.6;
  let lastArea = "";
  for (let i = 0; i < doc.photos.length; i += 2) {
    const pair = doc.photos.slice(i, i + 2);
    const captionLines = pair.map((p) => w.wrap(p.caption || " ", cellW).slice(0, 3));
    const rowH = imgH + 10 + Math.max(...captionLines.map((l) => l.length)) * 13 + 14;
    const area = pair[0]!.area;
    const showArea = area && area.toLowerCase() !== lastArea.toLowerCase();
    w.ensure(rowH + (showArea ? 18 : 0));
    if (showArea) {
      w.font(10.5, "bold");
      w.text(area, M, w.y + 10);
      w.y += 18;
      lastArea = area;
    }
    pair.forEach((photo, j) => {
      const x = M + j * (cellW + gap);
      const data = images.photos?.[photo.uri];
      if (data) {
        try {
          const props = w.pdf.getImageProperties(data);
          const ratio = props.width / props.height;
          let dw = cellW;
          let dh = cellW / ratio;
          if (dh > imgH) {
            dh = imgH;
            dw = imgH * ratio;
          }
          w.pdf.addImage(data, imageFormat(data), x + (cellW - dw) / 2, w.y + (imgH - dh) / 2, dw, dh);
        } catch {
          placeholder(w, x, cellW, imgH);
        }
      } else {
        placeholder(w, x, cellW, imgH);
      }
      w.font(9.5, "normal", MUTED);
      captionLines[j]!.forEach((line, k) => w.text(line, x, w.y + imgH + 14 + k * 13));
    });
    w.y += rowH;
  }
  w.y += 4;
}

function placeholder(w: Writer, x: number, width: number, height: number) {
  w.pdf.setFillColor(242, 243, 245);
  w.pdf.rect(x, w.y, width, height, "F");
  w.font(9.5, "normal", MUTED);
  w.text("Photo unavailable", x + width / 2, w.y + height / 2, { align: "center" });
}

function footer(w: Writer, doc: JobDocument) {
  const pages = w.pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    w.pdf.setPage(i);
    w.font(8.5, "normal", MUTED);
    w.text(`${doc.business.name ? doc.business.name + " · " : ""}${doc.title}`, M, PAGE_H - 28);
    w.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 28, { align: "right" });
  }
}

export async function buildPdf(doc: JobDocument, images: PdfImages = {}): Promise<jsPDF> {
  const w = new Writer();
  w.pdf.setProperties({ title: pdfSafe(doc.title), subject: DOC_LABELS[doc.doc_type], creator: "JobPaper" });
  header(w, doc, images);
  clientAndTitle(w, doc);

  if (doc.doc_type === "estimate") {
    itemsTable(w, "Description", doc.line_items);
    const rows = moneyRows(doc, "Total");
    const pct = depositPct(doc.terms);
    if (pct) rows.push([`Deposit (${pct}%)`, formatMoney((doc.totals.total * pct) / 100, true)]);
    totalsBlock(w, rows);
  }

  if (doc.doc_type === "change_order" && doc.change) {
    const c = doc.change;
    w.section("What changed", c.change_description);
    itemsTable(w, "Added", doc.line_items);
    itemsTable(w, "Removed", removedItems(c), -1);
    const rows = moneyRows(doc, "Net change");
    rows[rows.length - 1] = ["Net change", formatSignedMoney(c.net_change), true];
    totalsBlock(w, [
      ["Original estimate", formatMoney(c.original_total, true)],
      ...(c.previous_total !== c.original_total
        ? ([["Contract before this change", formatMoney(c.previous_total, true)]] as Array<[string, string]>)
        : []),
      ...rows,
      ["New contract total", formatMoney(c.new_total, true), true],
    ]);
    if (c.schedule_impact_days) {
      w.section(
        "Schedule impact",
        `${c.schedule_impact_days > 0 ? "Adds" : "Saves"} ${Math.abs(c.schedule_impact_days)} working day${Math.abs(c.schedule_impact_days) === 1 ? "" : "s"}.`,
      );
    }
  }

  if (doc.doc_type === "job_report" && doc.report) {
    const r = doc.report;
    const meta = [
      r.period === "weekly" ? "Weekly report" : "Daily report",
      r.crew_count !== null ? `Crew: ${formatQty(r.crew_count)}` : "",
      r.hours !== null ? `Hours: ${formatQty(r.hours)}` : "",
      r.weather_text ? `Weather: ${r.weather_text}` : "",
    ].filter(Boolean);
    w.font(10.5, "normal", MUTED);
    w.text(meta.join("   ·   "), M, w.y);
    w.y += 22;
    w.section("Work completed", r.work_done);
    await photoGrid(w, doc, images);
    w.section("Issues", r.issues);
    w.section("Next steps", r.next_steps);
  }

  w.section("Notes", doc.notes);
  w.section("Terms", doc.terms);

  if (doc.doc_type !== "job_report") {
    w.ensure(70);
    w.y += 20;
    const half = (CONTENT_W - 40) / 2;
    w.pdf.setDrawColor(MUTED[0], MUTED[1], MUTED[2]);
    w.pdf.setLineWidth(0.75);
    w.pdf.line(M, w.y, M + half, w.y);
    w.pdf.line(M + half + 40, w.y, PAGE_W - M, w.y);
    w.font(9, "normal", MUTED);
    w.text("Customer approval", M, w.y + 13);
    w.text("Date", M + half + 40, w.y + 13);
    w.y += 30;
  }

  footer(w, doc);
  return w.pdf;
}

export async function pdfBase64(doc: JobDocument, images?: PdfImages): Promise<string> {
  const pdf = await buildPdf(doc, images);
  const uri = pdf.output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}

export async function pdfBlob(doc: JobDocument, images?: PdfImages): Promise<Blob> {
  return (await buildPdf(doc, images)).output("blob");
}
