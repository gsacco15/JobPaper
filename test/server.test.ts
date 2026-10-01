import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleMcpRequest } from "../src/server/http.js";
import { MemorySettingsStore } from "../src/server/settings-store.js";
import type { JobPaperServerOptions } from "../src/server/server.js";
import { UI_URI } from "../src/server/server.js";
import { buildEstimate } from "../src/shared/build.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import type { JobDocument } from "../src/shared/document.js";

const store = new MemorySettingsStore();
const options: JobPaperServerOptions = {
  store,
  html: "<!doctype html><html><body>panel</body></html>",
  iconSvg: "<svg/>",
};

// Route the client's fetch straight into the web-standard handler, injecting
// the anonymized user id ChatGPT sends in _meta["openai/subject"].
function clientFor(subject?: string) {
  const fetchImpl: typeof fetch = async (input, init) => {
    let body = init?.body;
    if (subject && typeof body === "string") {
      const msg = JSON.parse(body);
      for (const m of Array.isArray(msg) ? msg : [msg]) {
        if (m.params && typeof m.params === "object") m.params._meta = { ...(m.params._meta ?? {}), "openai/subject": subject };
      }
      body = JSON.stringify(msg);
    }
    return handleMcpRequest(new Request(input as string | URL, { ...init, body }), options);
  };
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: fetchImpl });
  const client = new Client({ name: "test", version: "1.0.0" });
  return { client, transport };
}

let client: Client;

beforeAll(async () => {
  const c = clientFor("v1/user-a");
  client = c.client;
  await client.connect(c.transport);
});
afterAll(async () => {
  await client.close();
});

const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

describe("MCP server", () => {
  it("lists tools with the right annotations and entrypoints", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of ["create_estimate", "create_change_order", "create_job_report"]) {
      const t = byName[name]!;
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect((t._meta as any).ui.resourceUri).toBe(UI_URI);
      expect(t.description).toBeTruthy();
    }
    expect((byName.open_jobpaper!._meta as any)["openai/ui"].entrypoints).toEqual([{ type: "global" }, { type: "thread" }]);
    expect((byName.open_document_file!._meta as any)["openai/ui"].entrypoints).toEqual([
      { type: "file", extensions: [".est.json", ".co.json", ".rpt.json"] },
    ]);
    expect(byName["settings.read"]).toBeTruthy();
    expect(byName["settings.update"]).toBeTruthy();
    // No location or catch-all inputs.
    const est = byName.create_estimate!.inputSchema as any;
    expect(Object.keys(est.properties).sort()).toEqual(
      ["client_name", "job_address_text", "job_description", "line_items", "notes"].sort(),
    );
    expect(est.required).toEqual(["job_description"]);
  });

  it("advertises the settings capability", () => {
    const caps = client.getServerCapabilities() as any;
    const settings = caps.extensions?.["openai/settings"] ?? caps.experimental?.["openai/settings"];
    expect(settings).toEqual({ readTool: "settings.read", updateTool: "settings.update" });
  });

  it("serves the panel resource with display modes", async () => {
    const res = await client.readResource({ uri: UI_URI });
    const c = res.contents[0] as any;
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toContain("panel");
    expect(c._meta["openai/ui"].availableDisplayModes).toEqual(["inline", "fullscreen"]);
  });

  it("asks the model to draft lines first, and refuses empty descriptions", async () => {
    const noLines = await call("create_estimate", { job_description: "Paint a bedroom" });
    expect(noLines.isError).toBe(true);
    expect((noLines.content[0] as any).text).toMatch(/Draft 3–10/);
    const empty = await call("create_estimate", { job_description: "  " });
    expect(empty.isError).toBe(true);
    expect((empty.content[0] as any).text).toMatch(/what's the job/);
  });

  it("saves settings per user and applies them to estimates", async () => {
    const updated = (await call("settings.update", {
      set: { business_name: "Sacco Remodeling", phone: "512-555-0142", default_markup_pct: 10, default_tax_pct: 8.25 },
    })) as any;
    expect(updated.isError).toBeFalsy();
    expect(updated.structuredContent.values.business_name).toBe("Sacco Remodeling");
    const read = (await call("settings.read", {})) as any;
    expect(read.structuredContent.values).toMatchObject({ default_markup_pct: 10, default_tax_pct: 8.25 });
    expect(read.structuredContent.values.logo_data_url).toBeUndefined();

    const res = (await call("create_estimate", {
      job_description: "Bathroom remodel",
      client_name: "Pat Henderson",
      line_items: [{ name: "Demo", qty: 1, unit: "job", unit_price: 1000 }],
    })) as any;
    const doc = res.structuredContent.document as JobDocument;
    expect(doc.business.name).toBe("Sacco Remodeling");
    expect(doc.totals).toMatchObject({ subtotal: 1000, markup: 100, tax: 90.75, total: 1190.75 });
    const link = res.content.find((c: any) => c.type === "resource_link");
    expect(link.name).toBe("Bathroom remodel - Henderson.est.json");
    expect(res.structuredContent.file.uri).toBe(link.uri);
    expect(res.content[0].text).toContain("Total $1,190.75");

    // Another user doesn't see these settings.
    const other = clientFor("v1/user-b");
    await other.client.connect(other.transport);
    const theirs = (await other.client.callTool({ name: "settings.read", arguments: {} })) as any;
    expect(theirs.structuredContent.values.business_name).toBe("");
    await other.client.close();
  });

  it("refuses to save settings without a user id", async () => {
    const anon = clientFor(undefined);
    await anon.client.connect(anon.transport);
    const res = (await anon.client.callTool({ name: "settings.update", arguments: { set: { phone: "1" } } })) as any;
    expect(res.isError).toBe(true);
    await anon.client.close();
  });

  it("reads saved documents back from their URI", async () => {
    const res = (await call("create_estimate", {
      job_description: "Fence",
      line_items: [{ name: "Cedar fence", qty: 100, unit: "ln ft", unit_price: 35 }],
    })) as any;
    const read = await client.readResource({ uri: res.structuredContent.file.uri });
    const doc = JSON.parse((read.contents[0] as any).text) as JobDocument;
    expect(doc.totals.subtotal).toBe(3500);
  });

  it("builds a change order from the estimate file, then CO-2 from CO-1", async () => {
    const est = (await call("create_estimate", {
      job_description: "Deck",
      line_items: [
        { name: "Build 12x16 deck", qty: 1, unit: "job", unit_price: 8000 },
        { name: "Stain deck", qty: 1, unit: "job", unit_price: 600 },
      ],
    })) as any;
    const estDoc = est.structuredContent.document as JobDocument;
    const co1 = (await call("create_change_order", {
      estimate_file: est.structuredContent.file.uri,
      change_description: "Add stairs, skip the stain",
      added_items: [{ name: "Deck stairs", qty: 1, unit: "job", unit_price: 900 }],
      removed_item_ids: ["li_2"],
      schedule_impact_days: 1,
    })) as any;
    const co1Doc = co1.structuredContent.document as JobDocument;
    expect(co1Doc.doc_type).toBe("change_order");
    expect(co1Doc.change!.sequence).toBe(1);
    expect(co1Doc.change!.original_total).toBe(estDoc.totals.total);
    expect(co1Doc.totals.subtotal).toBe(300);
    expect(co1.structuredContent.file.name).toMatch(/^CO-1 · Deck.*\.co\.json$/);
    expect(co1Doc.references.source_uri).toBe(est.structuredContent.file.uri);

    const co2 = (await call("create_change_order", {
      estimate_file: co1.structuredContent.file.uri,
      change_description: "Add lights",
      added_items: [{ name: "Stair lights", qty: 4, unit: "each", unit_price: 50 }],
    })) as any;
    const co2Doc = co2.structuredContent.document as JobDocument;
    expect(co2Doc.change!.sequence).toBe(2);
    expect(co2Doc.change!.previous_total).toBe(co1Doc.change!.new_total);
    expect(co2Doc.references.estimate_id).toBe(estDoc.doc_id);
    expect(co2Doc.references.source_uri).toBe(est.structuredContent.file.uri);
  });

  it("accepts the estimate JSON inline and hands host files to the panel", async () => {
    const est = buildEstimate(
      { job_description: "Roof", line_items: [{ name: "Tear-off", unit_price: 4000 }] },
      { settings: DEFAULT_SETTINGS, date: "2026-09-30" },
    );
    const inline = (await call("create_change_order", { estimate_file: JSON.stringify(est), change_description: "Add vent" })) as any;
    expect(inline.structuredContent.document.change.original_total).toBe(4000);

    const pending = (await call("create_change_order", {
      estimate_file: "host-resource://abc",
      change_description: "Add vent",
    })) as any;
    expect(pending.isError).toBeFalsy();
    expect(pending.structuredContent.pending.estimate_file).toBe("host-resource://abc");
  });

  it("creates a job report with photos", async () => {
    const res = (await call("create_job_report", {
      job_name: "Henderson bath",
      notes: "Tile set in shower",
      photos: ["https://example.com/a.jpg", { uri: "https://example.com/b.jpg", caption: "Niche", area: "Shower" }],
      crew_count: 2,
    })) as any;
    const doc = res.structuredContent.document as JobDocument;
    expect(doc.doc_type).toBe("job_report");
    expect(doc.photos).toHaveLength(2);
    expect(res.structuredContent.file.name).toBe("Henderson bath - Daily Report.rpt.json");
  });

  it("opens entrypoints with empty and file arguments", async () => {
    const home = (await call("open_jobpaper", {})) as any;
    expect(home.structuredContent.view).toBe("home");
    const file = (await call("open_document_file", { file: { name: "x.est.json", resourceUri: "host-resource://x" } })) as any;
    expect(file.structuredContent).toMatchObject({ view: "file", file: { name: "x.est.json" } });
  });

  it("saves a logo only as an image data URL", async () => {
    const bad = (await call("save_logo", { logo_data_url: "javascript:alert(1)" })) as any;
    expect(bad.isError).toBe(true);
    const good = (await call("save_logo", { logo_data_url: "data:image/png;base64,iVBORw0KGgo=" })) as any;
    expect(good.isError).toBeFalsy();
    const s = (await call("get_settings", {})) as any;
    expect(s.structuredContent.settings.logo_data_url).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});
