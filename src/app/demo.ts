import { buildChangeOrder, buildEstimate, buildJobReport } from "../shared/build.js";
import type { JobDocument } from "../shared/document.js";
import { DEFAULT_SETTINGS, type BusinessSettings } from "../shared/settings.js";

// Sample documents for the standalone preview (screenshots, local design work).

export const DEMO_SETTINGS: BusinessSettings = {
  ...DEFAULT_SETTINGS,
  business_name: "Ruiz & Sons Remodeling",
  phone: "(512) 555-0142",
  email: "office@ruizremodel.com",
  default_markup_pct: 10,
  default_tax_pct: 8.25,
};

function photo(label: string, a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><g fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3">${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${i * 80 + 40}" x2="800" y2="${i * 80 + 40}"/><line x1="${i * 110 + 30}" y1="0" x2="${i * 110 + 30}" y2="600"/>`).join("")}</g><text x="40" y="560" font-family="Helvetica,Arial" font-size="40" fill="#fff">${label}</text></svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

export function demoDoc(kind: string): JobDocument {
  const ctx = { settings: DEMO_SETTINGS, date: "2026-09-30" };
  const estimate = buildEstimate(
    {
      job_description: "Bathroom remodel",
      client_name: "Pat Henderson",
      job_address_text: "1208 Oak Hollow Dr, Austin TX",
      line_items: [
        { name: "Demo existing tile, tub surround, and vanity", qty: 1, unit: "job", unit_price: 1450 },
        { name: "New porcelain tile floor, installed", qty: 52, unit: "sq ft", unit_price: 14 },
        { name: "Tile shower walls to ceiling", qty: 96, unit: "sq ft", unit_price: 18 },
        { name: "Install new vanity, faucet, and toilet", qty: 1, unit: "job", unit_price: 1100 },
        { name: "Patch, prime, and paint walls and ceiling", qty: 1, unit: "job", unit_price: 650 },
        { name: "Haul away debris", qty: 1, unit: "job", unit_price: 300 },
      ],
      notes: "Fixtures supplied by the homeowner. Price assumes no water damage behind the tub surround.",
    },
    ctx,
  );
  estimate.doc_id = "est_2026-09-30_h3nd";
  estimate.hints = [];
  if (kind === "change_order") {
    const co = buildChangeOrder(
      estimate,
      {
        change_description: "Homeowner added heated floors and a recessed shower niche. They'll keep the existing toilet.",
        added_items: [
          { name: "Electric heated floor mat with thermostat", qty: 52, unit: "sq ft", unit_price: 16 },
          { name: "Recessed shower niche, tiled", qty: 1, unit: "each", unit_price: 375 },
        ],
        removed_item_ids: [],
        schedule_impact_days: 2,
      },
      ctx,
    );
    co.hints = [];
    return co;
  }
  if (kind === "job_report") {
    const r = buildJobReport(
      {
        job_name: "Henderson bathroom",
        period: "daily",
        notes: "Finished demo and hauled out the old tub surround. Subfloor is solid — no water damage. Started setting cement board on the shower walls.",
        crew_count: 3,
        hours: 8,
        weather_text: "Sunny, 88°F",
        issues: "Grout color the homeowner picked is backordered about a week.",
        next_steps: "Finish cement board and waterproofing tomorrow. Tile starts Thursday.",
        photos: [
          { uri: photo("Shower wall", "#8a7f74", "#4d4640"), caption: "Old surround out, studs exposed", area: "Shower" },
          { uri: photo("Cement board", "#9aa3a8", "#5c656b"), caption: "Cement board going up", area: "Shower" },
          { uri: photo("Subfloor", "#a68b6b", "#6b5440"), caption: "Subfloor checked — dry and solid", area: "Floor" },
          { uri: photo("Debris", "#7d8a6e", "#46523b"), caption: "Debris hauled away", area: "Floor" },
        ],
      },
      ctx,
    );
    r.client = { name: "Pat Henderson", address_text: "1208 Oak Hollow Dr, Austin TX" };
    r.hints = [];
    return r;
  }
  return estimate;
}
