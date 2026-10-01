// Walkthrough: fake ChatGPT host + real panel + real server, screenshots per step.
// Run: npx tsx test/demo-walkthrough.ts <outDir>
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { handleMcpRequest } from "../src/server/http.js";
import { MemorySettingsStore } from "../src/server/settings-store.js";
import { ICON_SVG } from "../src/generated/assets.js";

const out = process.argv[2] ?? "walkthrough";
mkdirSync(out, { recursive: true });
const hostJs = (await build({ entryPoints: ["test/e2e/host.ts"], bundle: true, format: "esm", write: false, platform: "browser", target: "es2022" })).outputFiles[0]!.text;
const options = { store: new MemorySettingsStore(), html: readFileSync("dist/app/index.html", "utf8"), iconSvg: ICON_SVG };
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/mcp")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await handleMcpRequest(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), options);
    res.statusCode = r.status;
    r.headers.forEach((v, k) => res.setHeader(k, v));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (req.url?.startsWith("/host.js")) { res.setHeader("content-type", "text/javascript"); return res.end(hostJs); }
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><body style="margin:0;background:#f4f4f4"><script type="module" src="/host.js"></script></body></html>`);
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const root = "/opt/pw-browsers";
const dir = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const browser = await chromium.launch({ executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined });
const page = await browser.newPage({ viewport: { width: 420, height: 840 }, deviceScaleFactor: 2 });
await page.goto(`${base}/?subject=v1/demo`);
await page.waitForFunction(() => (window as any).__host?.ready);
const frame = () => page.frames().find((f) => f !== page.mainFrame())!;
let n = 0;
const shot = async (name: string) => {
  await page.waitForTimeout(400);
  await page.locator("#frame").screenshot({ path: `${out}/${String(++n).padStart(2, "0")}-${name}.png` });
  console.log("shot", name);
};

// Settings the contractor saved once.
await page.evaluate(() => (window as any).__host.callTool("settings.update", { set: { business_name: "Lee Fence Co.", phone: "(512) 555-0199", default_markup_pct: 10, default_tax_pct: 8.25 } }));

// 1. What ChatGPT sends after "write up an estimate for a 6 ft cedar fence, 120 linear feet, for the Lees"
const estArgs = {
  job_description: "6 ft cedar privacy fence, 120 linear feet, for the Lees",
  client_name: "Dana Lee",
  line_items: [
    { name: "Remove and haul away old fence", qty: 120, unit: "ln ft", unit_price: 4 },
    { name: "Set 4x4 posts in concrete, 8 ft apart", qty: 16, unit: "each", unit_price: 65 },
    { name: "Install 6 ft cedar pickets and rails", qty: 120, unit: "ln ft", unit_price: 32 },
    { name: "Install walk gate with hardware", qty: 1, unit: "each", unit_price: 450 },
  ],
  notes: "Assumes no rock or utility lines at post locations.",
};
const est: any = await page.evaluate((a) => (window as any).__host.runTool("create_estimate", a, "inline"), estArgs);
await frame().getByText("Total").first().waitFor();
await shot("inline-card-in-chat");
console.log("model reply hint:", est.content[0].text.split("\n").pop());

await frame().getByRole("button", { name: "Open", exact: true }).click();
await frame().getByText("+ Add line").waitFor();
await shot("opened-full-panel");

await frame().getByRole("button", { name: /^Install 6 ft cedar/ }).click();
const price = frame().getByLabel("Unit price in dollars");
await price.fill("34");
await price.press("Enter");
await shot("editing-a-line");
await frame().getByRole("button", { name: "Done" }).click();
await shot("totals-updated");

await frame().getByRole("button", { name: "Download PDF" }).click();
await frame().getByText("PDF ready").waitFor();
await shot("pdf-downloaded");
const dl: any = (await page.evaluate(() => (window as any).__host.log.filter((e: any) => e.method === "ui/download-file")))[0];
const { writeFileSync } = await import("node:fs");
writeFileSync(`${out}/Lee-fence-estimate.pdf`, Buffer.from(dl.params.contents[0].resource.blob, "base64"));

// 2. "The customer added a second gate. Change order."
const coArgs = { estimate_file: est.structuredContent.file.uri, change_description: "Customer added a second walk gate on the side yard.", added_items: [{ name: "Second walk gate with hardware", qty: 1, unit: "each", unit_price: 450 }], schedule_impact_days: 1 };
await page.evaluate((a) => (window as any).__host.runTool("create_change_order", a, "fullscreen"), coArgs);
await frame().getByText("New contract total").waitFor();
await shot("change-order");

await browser.close();
server.close();
