import { describe, expect, it } from "vitest";
import { buildChangeOrder, buildEstimate, buildJobReport, deriveTitle } from "../src/shared/build.js";
import { DEFAULT_SETTINGS, type BusinessSettings } from "../src/shared/settings.js";
import { computeTotals, contractItemsAfter, depositPct, formatMoney, recompute, roundMoney } from "../src/shared/totals.js";
import { decodeDocUri, encodeDocUri, fileNameFor, resolveInlineDocument } from "../src/shared/files.js";
import { normalizeDocument, normalizeLineItems } from "../src/shared/normalize.js";
import { assignLineIds, nextLineId } from "../src/shared/ids.js";
import { toSmsText } from "../src/shared/text.js";

const settings: BusinessSettings = {
  ...DEFAULT_SETTINGS,
  business_name: "Sacco Remodeling",
  phone: "512-555-0142",
  default_markup_pct: 10,
  default_tax_pct: 8.25,
};
const ctx = { settings, date: "2026-09-30" };

const bathroom = () =>
  buildEstimate(
    {
      job_description: "Bathroom remodel for the Hendersons",
      client_name: "Pat Henderson",
      line_items: [
        { name: "Demo existing tile and vanity", qty: 1, unit: "job", unit_price: 650 },
        { name: "New tile floor", qty: 48, unit: "sq ft", unit_price: 14 },
        { name: "Install vanity and faucet", qty: 1, unit: "job", unit_price: 900 },
      ],
    },
    ctx,
  );

describe("totals", () => {
  it("rounds money to cents without drift", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(Number.NaN)).toBe(0);
  });

  it("applies markup then tax on subtotal + markup", () => {
    const t = computeTotals(1000, 10, 8.25);
    expect(t).toEqual({ subtotal: 1000, markup_pct: 10, markup: 100, tax_pct: 8.25, tax: 90.75, total: 1190.75 });
  });

  it("clamps silly percentages", () => {
    expect(computeTotals(100, -5, 500).markup_pct).toBe(0);
    expect(computeTotals(100, -5, 500).tax_pct).toBe(100);
  });

  it("reads the deposit from terms", () => {
    expect(depositPct("50% deposit to schedule, balance on completion.")).toBe(50);
    expect(depositPct("Pay 30 % down")).toBe(30);
    expect(depositPct("Net 30")).toBeNull();
  });

  it("formats money", () => {
    expect(formatMoney(1234)).toBe("$1,234");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(-20)).toBe("-$20");
  });
});

describe("ids", () => {
  it("keeps unique ids and fills the rest", () => {
    expect(assignLineIds([{ id: "li_3" }, {}, { id: "li_3" }, { id: "bogus" }])).toEqual(["li_3", "li_4", "li_5", "li_6"]);
    expect(nextLineId(["li_1", "li_9"])).toBe("li_10");
  });

  it("avoids reserved ids", () => {
    expect(assignLineIds([{}, {}], ["li_1", "li_2"])).toEqual(["li_3", "li_4"]);
  });
});

describe("estimate", () => {
  it("computes totals server-side from settings", () => {
    const doc = bathroom();
    expect(doc.doc_type).toBe("estimate");
    expect(doc.doc_id).toMatch(/^est_2026-09-30_[a-z0-9]{4}$/);
    expect(doc.line_items.map((l) => l.id)).toEqual(["li_1", "li_2", "li_3"]);
    expect(doc.totals.subtotal).toBe(650 + 672 + 900);
    expect(doc.totals.markup).toBe(222.2);
    expect(doc.totals.tax).toBe(201.65);
    expect(doc.totals.total).toBe(2645.85);
    expect(doc.business.name).toBe("Sacco Remodeling");
    expect(doc.title).toBe("Bathroom remodel for the Hendersons — Henderson");
    expect(doc.valid_days).toBe(30);
    expect(doc.terms).toBe(DEFAULT_SETTINGS.default_terms);
  });

  it("normalizes units and drops unnamed lines", () => {
    const items = normalizeLineItems([
      { name: "Paint", qty: 2, unit: "Hours", unit_price: "65" },
      { name: "", qty: 1 },
      { description: "Baseboard", quantity: 40, unit: "LF", price: 3.5 },
    ]);
    expect(items).toEqual([
      { id: "li_1", name: "Paint", qty: 2, unit: "hr", unit_price: 65 },
      { id: "li_2", name: "Baseboard", qty: 40, unit: "ln ft", unit_price: 3.5 },
    ]);
  });

  it("adds a settings hint when markup and tax are unset", () => {
    const doc = buildEstimate({ job_description: "Fence repair" }, { settings: DEFAULT_SETTINGS, date: "2026-09-30" });
    expect(doc.hints?.some((h) => h.startsWith("Markup and tax"))).toBe(true);
    expect(doc.hints?.some((h) => h.includes("business name"))).toBe(true);
    expect(doc.totals.total).toBe(0);
  });

  it("derives plain titles", () => {
    expect(deriveTitle("write up an estimate for a 6ft cedar fence", "")).toBe("6ft cedar fence");
    expect(deriveTitle("Kitchen paint. Two coats.", "Ana Ruiz")).toBe("Kitchen paint — Ruiz");
  });
});

describe("change orders", () => {
  it("reads the original total and computes delta and new total", () => {
    const est = bathroom();
    const co = buildChangeOrder(
      est,
      {
        change_description: "Customer added a heated floor and dropped the vanity install",
        added_items: [{ name: "Heated floor mat", qty: 48, unit: "sq ft", unit_price: 12 }],
        removed_item_ids: ["li_3"],
        schedule_impact_days: 2,
      },
      ctx,
    );
    expect(co.change?.sequence).toBe(1);
    expect(co.title).toBe(`CO-1 · ${est.title}`);
    expect(co.references.estimate_id).toBe(est.doc_id);
    expect(co.change?.original_total).toBe(est.totals.total);
    expect(co.change?.previous_total).toBe(est.totals.total);
    expect(co.line_items[0]?.id).toBe("li_4"); // never collides with estimate ids
    expect(co.totals.subtotal).toBe(576 - 900);
    const expected = computeTotals(576 - 900, 10, 8.25).total;
    expect(co.change?.net_change).toBe(expected);
    expect(co.change?.new_total).toBe(roundMoney(est.totals.total + expected));
    expect(co.change?.schedule_impact_days).toBe(2);
  });

  it("chains CO-2 from CO-1's new total", () => {
    const est = bathroom();
    const co1 = buildChangeOrder(est, { change_description: "Add niche", added_items: [{ name: "Shower niche", unit_price: 350 }] }, ctx);
    const co2 = buildChangeOrder(co1, { change_description: "Remove demo", removed_item_ids: ["Demo existing tile and vanity"] }, ctx);
    expect(co2.change?.sequence).toBe(2);
    expect(co2.title).toBe(`CO-2 · ${est.title}`);
    expect(co2.references.estimate_id).toBe(est.doc_id);
    expect(co2.references.previous_change_order_id).toBe(co1.doc_id);
    expect(co2.change?.original_total).toBe(est.totals.total);
    expect(co2.change?.previous_total).toBe(co1.change?.new_total);
    expect(co2.change?.removed_ids).toEqual(["li_1"]);
    expect(contractItemsAfter(co2).map((l) => l.name)).toEqual(["New tile floor", "Install vanity and faucet", "Shower niche"]);
  });

  it("ignores unknown removals and refuses job reports", () => {
    const est = bathroom();
    const co = buildChangeOrder(est, { change_description: "x", removed_item_ids: ["li_99"] }, ctx);
    expect(co.change?.removed_ids).toEqual([]);
    expect(co.change?.net_change).toBe(0);
    const rpt = buildJobReport({ job_name: "Henderson", notes: "Tile done" }, ctx);
    expect(() => buildChangeOrder(rpt, { change_description: "x" }, ctx)).toThrow(/estimate/);
  });

  it("recomputes after panel edits", () => {
    const est = bathroom();
    const co = buildChangeOrder(est, { change_description: "x", added_items: [{ name: "A", unit_price: 100 }] }, ctx);
    const edited = recompute({ ...co, line_items: [{ ...co.line_items[0]!, qty: 3 }] });
    expect(edited.totals.subtotal).toBe(300);
    expect(edited.change?.new_total).toBe(roundMoney(est.totals.total + computeTotals(300, 10, 8.25).total));
  });
});

describe("job report", () => {
  it("groups photos by area and keeps captions", () => {
    const rpt = buildJobReport(
      {
        job_name: "Henderson bath",
        period: "daily",
        notes: "Set tile in shower",
        crew_count: 2,
        hours: 8,
        photos: [
          { uri: "https://x/1.jpg", caption: "Shower wall", area: "Shower" },
          { uri: "https://x/2.jpg", caption: "Floor prep", area: "Floor" },
          { uri: "https://x/3.jpg", caption: "Niche", area: "shower" },
          "https://x/4.jpg",
        ],
        issues: "Grout color backordered",
      },
      ctx,
    );
    expect(rpt.title).toBe("Henderson bath — Daily Report");
    expect(rpt.photos.map((p) => p.uri)).toEqual(["https://x/1.jpg", "https://x/3.jpg", "https://x/2.jpg", "https://x/4.jpg"]);
    expect(rpt.report?.crew_count).toBe(2);
    expect(rpt.report?.issues).toBe("Grout color backordered");
  });
});

describe("files", () => {
  it("round-trips through a self-contained URI without the logo", () => {
    const est = { ...bathroom(), business: { ...bathroom().business, logo_data_url: "data:image/png;base64,AAAA" } };
    const uri = encodeDocUri(est);
    expect(uri.startsWith("jobpaper://doc/")).toBe(true);
    expect(decodeURIComponent(uri)).toContain(".est.json?z=");
    expect(uri.length).toBeLessThan(JSON.stringify(est).length);
    const back = decodeDocUri(uri)!;
    expect(back.doc_id).toBe(est.doc_id);
    expect(back.totals.total).toBe(est.totals.total);
    expect(back.business.logo_data_url).toBe("");
    expect(back.line_items).toEqual(est.line_items);
  });

  it("handles unicode titles", () => {
    const est = { ...bathroom(), title: "Baño — Núñez ✓" };
    expect(decodeDocUri(encodeDocUri(est))?.title).toBe("Baño — Núñez ✓");
  });

  it("makes safe file names", () => {
    expect(fileNameFor({ title: 'Deck / "rail" — Lee', doc_type: "change_order" })).toBe("Deck rail - Lee.co.json");
  });

  it("resolves pasted JSON and rejects junk", () => {
    const est = bathroom();
    expect(resolveInlineDocument(JSON.stringify(est))?.doc_id).toBe(est.doc_id);
    expect(resolveInlineDocument("host-resource://abc")).toBeNull();
    expect(decodeDocUri("jobpaper://doc/x?d=!!!")).toBeNull();
    // A model that garbles the payload gets a clean failure, not a wrong document.
    const uri = encodeDocUri(est);
    expect(decodeDocUri(uri.slice(0, -12) + "AAAAAAAAAAAA")).toBeNull();
    expect(decodeDocUri(uri.slice(0, -5))).toBeNull();
    expect(normalizeDocument({ doc_type: "invoice" })).toBeNull();
  });
});

describe("copy as text", () => {
  it("is short and includes total, deposit, and phone", () => {
    const text = toSmsText(bathroom());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Sacco Remodeling — Estimate: Bathroom remodel for the Hendersons — Henderson");
    expect(text).toContain("Total: $2,645.85");
    expect(text).toContain("Deposit to schedule: $1,322.93 (50%)");
    expect(lines.at(-1)).toBe("Questions? 512-555-0142");
    expect(lines.length).toBeLessThanOrEqual(10);
  });

  it("summarizes change orders", () => {
    const est = bathroom();
    const co = buildChangeOrder(est, { change_description: "x", added_items: [{ name: "Niche", unit_price: 350 }] }, ctx);
    const text = toSmsText(co);
    expect(text).toContain("+ Niche: $350");
    expect(text).toContain("New contract total:");
  });
});
