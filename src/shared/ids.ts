import type { DocType, LineItem } from "./document.js";

const PREFIX: Record<DocType, string> = {
  estimate: "est",
  change_order: "co",
  job_report: "rpt",
};

function randomSuffix(length = 4): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** est_2026-09-30_a1b2 */
export function newDocId(type: DocType, date: string): string {
  return `${PREFIX[type]}_${date}_${randomSuffix()}`;
}

/** Next free li_N id given the ids already in use. */
export function nextLineId(used: Iterable<string>): string {
  let max = 0;
  for (const id of used) {
    const m = /^li_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `li_${max + 1}`;
}

/**
 * Give every line a stable, unique id. Existing unique ids are kept so the panel
 * and change orders can keep referring to them.
 */
export function assignLineIds(items: Array<Partial<LineItem>>, reserved: Iterable<string> = []): string[] {
  const used = new Set<string>(reserved);
  const ids: string[] = [];
  for (const item of items) {
    const id = typeof item.id === "string" && /^li_\d+$/.test(item.id) && !used.has(item.id) ? item.id : "";
    ids.push(id);
    if (id) used.add(id);
  }
  return ids.map((id) => {
    if (id) return id;
    const fresh = nextLineId(used);
    used.add(fresh);
    return fresh;
  });
}

/** Today's date as YYYY-MM-DD in the given IANA time zone (defaults to UTC). */
export function isoDate(now = new Date(), timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
