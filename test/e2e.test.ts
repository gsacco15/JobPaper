import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { handleMcpRequest } from "../src/server/http.js";
import { MemorySettingsStore } from "../src/server/settings-store.js";
import { ICON_SVG } from "../src/generated/assets.js";

// End-to-end: real server + real bundled panel + a fake ChatGPT host page.
// Requires `npm run build:app` first (dist/app/index.html).

const panelPath = new URL("../dist/app/index.html", import.meta.url);
const hasPanel = existsSync(panelPath);
const chromiumPath = (() => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return dir ? `${root}/${dir}/chrome-linux/chrome` : undefined;
})();

let server: Server;
let browser: Browser;
let base = "";

beforeAll(async () => {
  if (!hasPanel) return;
  const hostJs = (
    await build({ entryPoints: ["test/e2e/host.ts"], bundle: true, format: "esm", write: false, platform: "browser", target: "es2022" })
  ).outputFiles[0]!.text;
  const options = { store: new MemorySettingsStore(), html: readFileSync(panelPath, "utf8"), iconSvg: ICON_SVG };
  server = createServer(async (req, res) => {
    if (req.url?.startsWith("/mcp")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const response = await handleMcpRequest(
        new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }),
        options,
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.url?.startsWith("/host.js")) {
      res.setHeader("content-type", "text/javascript");
      return res.end(hostJs);
    }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><body><script type="module" src="/host.js"></script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chromiumPath });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r(null)));
});

async function openHost(): Promise<Page> {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  if (process.env.E2E_DEBUG) page.on("console", (m) => console.log("console:", m.text()));
  await page.goto(`${base}/?subject=v1/${Math.random()}`);
  await page.waitForFunction(() => (window as any).__host?.ready, null, { timeout: 15_000 });
  return page;
}

function panel(page: Page): Frame {
  return page.frames().find((f) => f !== page.mainFrame())!;
}

const log = (page: Page, method: string) =>
  page.evaluate((m) => (window as any).__host.log.filter((e: any) => e.method === m), method) as Promise<any[]>;

const ESTIMATE_ARGS = {
  job_description: "Bathroom remodel",
  client_name: "Pat Henderson",
  line_items: [
    { name: "Demo existing tile and vanity", qty: 1, unit: "job", unit_price: 650 },
    { name: "New tile floor", qty: 48, unit: "sq ft", unit_price: 14 },
  ],
};

describe.skipIf(!hasPanel)("panel in a host", () => {
  it("renders the inline card, opens fullscreen, edits a line, and syncs the model", async () => {
    const page = await openHost();
    await page.evaluate((a) => (window as any).__host.runTool("create_estimate", a, "inline"), ESTIMATE_ARGS);
    const f = panel(page);
    await f.getByText("Bathroom remodel — Henderson").waitFor();
    await f.getByText("$1,322.00").waitFor(); // inline card total
    await f.getByRole("button", { name: "Open", exact: true }).click();
    expect((await log(page, "ui/request-display-mode"))[0].params).toEqual({ mode: "fullscreen" });

    await f.getByRole("button", { name: /^New tile floor/ }).click();
    const qty = f.getByLabel("Quantity");
    await qty.fill("50");
    await qty.press("Enter");
    await f.getByRole("button", { name: "Done" }).click();
    await f.getByText("$1,350.00").first().waitFor();

    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "ui/update-model-context"), null, { timeout: 5000 });
    const ctx = (await log(page, "ui/update-model-context")).at(-1).params;
    expect(ctx.structuredContent.document.totals.total).toBe(1350);
    expect(ctx.content[0].text).toContain("total $1,350");
    expect(ctx.content[1].resource.uri).toMatch(/^jobpaper:\/\/doc\/.*\.est\.json/);
    await page.close();
  }, 30_000);

  it("downloads a PDF through the host and copies text", async () => {
    const page = await openHost();
    await page.evaluate((a) => (window as any).__host.runTool("create_estimate", a, "fullscreen"), ESTIMATE_ARGS);
    const f = panel(page);
    await f.getByRole("button", { name: "Download PDF" }).click();
    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "ui/download-file"), null, { timeout: 10_000 });
    const dl = (await log(page, "ui/download-file"))[0].params.contents[0];
    expect(dl.resource.mimeType).toBe("application/pdf");
    expect(dl.resource.uri).toContain("Bathroom%20remodel%20-%20Henderson.pdf");
    expect(Buffer.from(dl.resource.blob, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    await f.getByText("PDF ready").waitFor();
    await page.close();
  }, 30_000);

  it("remembers markup and tax as defaults", async () => {
    const page = await openHost();
    await page.evaluate((a) => (window as any).__host.runTool("create_estimate", a, "fullscreen"), ESTIMATE_ARGS);
    const f = panel(page);
    await f.getByRole("button", { name: /^Tax/ }).click();
    const tax = f.getByLabel("Tax percent");
    await tax.fill("8.25");
    await tax.press("Enter");
    await f.getByText("Saved as your default").waitFor();
    const settings = await page.evaluate(() => (window as any).__host.callTool("settings.read", {}));
    expect(settings.structuredContent.values.default_tax_pct).toBe(8.25);
    await f.getByText("$1,431.07").first().waitFor();
    await page.close();
  }, 30_000);

  it("opens a saved file, writes edits back, and drafts a change order from it", async () => {
    const page = await openHost();
    const est = await page.evaluate((a) => (window as any).__host.callTool("create_estimate", a), ESTIMATE_ARGS);
    const text = JSON.stringify(est.structuredContent.document);
    await page.evaluate((t) => (window as any).__host.addFile("host-resource://henderson", t), text);
    await page.evaluate(() =>
      (window as any).__host.runTool("open_document_file", { file: { name: "Henderson.est.json", resourceUri: "host-resource://henderson" } }, "fullscreen"),
    );
    const f = panel(page);
    await f.getByText("Bathroom remodel — Henderson").waitFor();

    await f.getByRole("button", { name: /^Title/ }).click();
    const title = f.getByLabel("Title");
    await title.fill("Henderson master bath");
    await title.press("Enter");
    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "openai/resources/write"), null, { timeout: 5000 });
    const written = JSON.parse((await log(page, "openai/resources/write"))[0].params.text);
    expect(written.title).toBe("Henderson master bath");
    expect(written.business.logo_data_url).toBe("");

    await f.getByRole("button", { name: "Make a change order" }).click();
    await f.getByLabel("What changed?").fill("Add a heated floor");
    await f.getByRole("button", { name: "Draft change order" }).click();
    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "ui/message"), null, { timeout: 5000 });
    const msg = (await log(page, "ui/message"))[0].params.content[0].text;
    expect(msg).toContain("estimate_file: host-resource://henderson");
    expect(msg).toContain("Add a heated floor");
    await page.close();
  }, 30_000);

  it("finishes a change order in the panel when the server can't read the file", async () => {
    const page = await openHost();
    const est = await page.evaluate((a) => (window as any).__host.callTool("create_estimate", a), ESTIMATE_ARGS);
    if (process.env.E2E_DEBUG) console.log("step: estimate created");
    await page.evaluate((t) => (window as any).__host.addFile("host-resource://est", t), JSON.stringify(est.structuredContent.document));
    if (process.env.E2E_DEBUG) console.log("step: file added");
    await page.evaluate(() =>
      (window as any).__host.runTool(
        "create_change_order",
        { estimate_file: "host-resource://est", change_description: "Add niche", added_items: [{ name: "Shower niche", unit_price: 350 }], removed_item_ids: ["li_1"] },
        "fullscreen",
      ),
    );
    const f = panel(page);
    await f.getByText("New contract total").waitFor();
    await f.getByText("Shower niche").waitFor();
    // 1322 - 650 + 350
    await f.getByText("$1,022.00").waitFor();
    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "ui/update-model-context"), null, { timeout: 5000 });
    const ctx = (await log(page, "ui/update-model-context"))[0].params;
    expect(ctx.structuredContent.document.change.new_total).toBe(1022);
    await page.close();
  }, 30_000);

  it("opens the original estimate from a change order", async () => {
    const page = await openHost();
    const est = await page.evaluate((a) => (window as any).__host.callTool("create_estimate", a), ESTIMATE_ARGS);
    await page.evaluate(
      (uri) => (window as any).__host.runTool("create_change_order", { estimate_file: uri, change_description: "Add niche", added_items: [{ name: "Niche", unit_price: 350 }] }, "fullscreen"),
      est.structuredContent.file.uri,
    );
    const f = panel(page);
    await f.getByRole("button", { name: "Open original estimate" }).click();
    await f.getByText("ESTIMATE", { exact: false }).first().waitFor();
    await f.getByText("Demo existing tile and vanity").waitFor();
    await f.getByRole("button", { name: "‹ Back" }).click();
    await f.getByText("New contract total").waitFor();
    await page.close();
  }, 30_000);

  it("shows the home screen and sends a starter prompt", async () => {
    const page = await openHost();
    await page.evaluate(() => (window as any).__host.runTool("open_jobpaper", {}, "fullscreen"));
    const f = panel(page);
    await f.getByRole("tab", { name: "Job report" }).click();
    await f.getByRole("textbox").first().fill("Henderson bath, set tile");
    await f.getByRole("button", { name: "Write it up" }).click();
    await page.waitForFunction(() => (window as any).__host.log.some((e: any) => e.method === "ui/message"), null, { timeout: 5000 });
    expect((await log(page, "ui/message"))[0].params.content[0].text).toBe("Daily report for the job: Henderson bath, set tile");
    await page.close();
  }, 30_000);

  it("shows a placeholder when a photo fails to load", async () => {
    const page = await openHost();
    await page.evaluate(() =>
      (window as any).__host.runTool("create_job_report", { job_name: "Henderson", notes: "Tile set", photos: ["host-resource://missing.jpg"] }, "fullscreen"),
    );
    const f = panel(page);
    await f.getByText("Photo didn’t load").waitFor({ timeout: 10_000 });
    await page.close();
  }, 30_000);
});
