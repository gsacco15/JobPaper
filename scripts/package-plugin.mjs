// Builds the plugin ZIP for upload at platform.openai.com/plugins and checks
// the manifest against the submission limits first. Usage: node scripts/package-plugin.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, ".codex-plugin/plugin.json"), "utf8"));
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const i = manifest.interface ?? {};
check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name) && manifest.name.length <= 64, "name: lowercase-hyphen, ≤64");
check(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ""), "version: semver");
check((i.displayName ?? "").length > 0 && i.displayName.length <= 30, "displayName ≤30");
check((i.shortDescription ?? "").length > 0 && i.shortDescription.length <= 30, `shortDescription ≤30 (is ${(i.shortDescription ?? "").length})`);
check((i.longDescription ?? "").length > 0 && i.longDescription.length <= 4000, "longDescription ≤4000");
for (const k of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) check(/^https:\/\//.test(i[k] ?? ""), `${k} must be https`);
const prompts = [].concat(i.defaultPrompt ?? []);
check(prompts.length <= 3 && prompts.every((p) => p.length <= 128) && new Set(prompts).size === prompts.length, "defaultPrompt: ≤3 unique, ≤128 chars");
for (const k of ["brandColor", "brandColorDark"]) if (i[k]) check(/^#[0-9A-Fa-f]{6}$/.test(i[k]), `${k} #RRGGBB`);
const files = new Set([".codex-plugin/plugin.json", ".mcp.json"]);
for (const k of ["composerIcon", "composerIconDark", "logo", "logoDark", ...(i.screenshots ?? []).map((_, n) => `screenshots.${n}`)]) {
  const p = k.startsWith("screenshots.") ? i.screenshots[Number(k.split(".")[1])] : i[k];
  if (!p) continue;
  const rel = p.replace(/^\.\//, "");
  check(existsSync(join(root, rel)), `${k}: missing file ${p}`);
  if (existsSync(join(root, rel))) check(statSync(join(root, rel)).size <= 5 * 1024 * 1024, `${k}: >5 MiB`);
  files.add(rel);
}
const review = manifest.extensions?.["com.openai"]?.review;
check(review?.test_cases?.positive?.length === 5, "review: exactly 5 positive cases");
check(review?.test_cases?.negative?.length === 3, "review: exactly 3 negative cases");
for (const c of review?.test_cases?.positive ?? []) check(c.description && c.prompt && c.tools_triggered && c.expected_behavior, `positive case incomplete: ${c.description?.slice(0, 40)}`);
for (const c of review?.test_cases?.negative ?? []) check(c.description && c.prompt, "negative case incomplete");
const onboarding = manifest.extensions?.["com.openai"]?.onboardingSkill;
if (onboarding) check(existsSync(join(root, onboarding)), `onboardingSkill missing: ${onboarding}`);
const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
check(Object.keys(mcp.mcpServers ?? {}).length === 1, ".mcp.json: exactly one server");
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => (statSync(join(root, dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const f of walk("skills")) files.add(f);
for (const f of walk("skills").filter((f) => f.endsWith("SKILL.md"))) {
  const head = readFileSync(join(root, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
  check(head && /\nname: |^name: /.test(head[1]) && /description: /.test(head[1]), `${f}: needs name and description front matter`);
}
if (!review?.demo_recording_url) console.warn("⚠ review.demo_recording_url not set — required before submitting for review (add it to plugin.json once you have the video link).");
if (errors.length) {
  console.error("Plugin package problems:\n- " + errors.join("\n- "));
  process.exit(1);
}
const zip = zipSync(Object.fromEntries([...files].sort().map((f) => [f, readFileSync(join(root, f))])), { level: 9 });
mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, `dist/jobpaper-plugin-${manifest.version}.zip`);
writeFileSync(out, zip);
console.log(`✓ ${out} (${(zip.length / 1024).toFixed(0)} KB, ${files.size} files)`);
for (const f of [...files].sort()) console.log("  " + f);
