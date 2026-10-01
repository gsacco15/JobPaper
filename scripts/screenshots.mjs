// Renders the panel's standalone preview at phone width in light and dark,
// for the store listing and for checking layout. Usage: node scripts/screenshots.mjs [outDir]
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const out = process.argv[2] ?? "docs/screenshots";
mkdirSync(out, { recursive: true });
const html = pathToFileURL(new URL("../dist/app/index.html", import.meta.url).pathname).href;

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium")).sort().reverse()) {
    for (const p of [`${root}/${dir}/chrome-linux/chrome`, `${root}/${dir}/chrome-linux64/chrome`]) if (existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const shots = [
  ["estimate", "light", "fullscreen"],
  ["estimate", "dark", "fullscreen"],
  ["change_order", "light", "fullscreen"],
  ["job_report", "light", "fullscreen"],
  ["estimate", "light", "inline"],
  ["home", "light", "fullscreen"],
];
for (const [demo, theme, mode] of shots) {
  const page = await browser.newPage({ viewport: { width: 390, height: mode === "inline" ? 300 : 844 }, deviceScaleFactor: 2, colorScheme: theme });
  await page.goto(`${html}?demo=${demo}&theme=${theme}&mode=${mode}`);
  await page.waitForTimeout(600);
  if (mode !== "inline") {
    // Grow the viewport to the full document so the sticky footer lands at the bottom.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 390, height: Math.max(844, height) });
    await page.waitForTimeout(200);
  }
  const file = `${out}/${demo}-${theme}${mode === "inline" ? "-inline" : ""}.png`;
  await page.screenshot({ path: file, fullPage: mode !== "inline" });
  console.log("wrote", file);
  await page.close();
}
await browser.close();
