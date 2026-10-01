// Clicks "Download PDF" in the standalone preview for each sample document and
// saves the PDFs (the same on-device code path users hit). Usage: node scripts/pdf-samples.mjs [outDir]
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const out = process.argv[2] ?? "docs/samples";
mkdirSync(out, { recursive: true });
const html = pathToFileURL(new URL("../dist/app/index.html", import.meta.url).pathname).href;
const exe = (() => {
  const root = "/opt/pw-browsers";
  if (process.env.CHROMIUM_PATH || !existsSync(root)) return process.env.CHROMIUM_PATH;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return dir ? `${root}/${dir}/chrome-linux/chrome` : undefined;
})();

const browser = await chromium.launch({ executablePath: exe });
for (const demo of ["estimate", "change_order", "job_report"]) {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${html}?demo=${demo}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  const file = `${out}/${demo}.pdf`;
  await download.saveAs(file);
  console.log("wrote", file, download.suggestedFilename());
  await page.close();
}
await browser.close();
