import { ICON_SVG, PANEL_HTML } from "../generated/assets.js";
import type { JobPaperServerOptions } from "./server.js";
import { createSettingsStore, type SettingsStore } from "./settings-store.js";

let sharedStore: SettingsStore | undefined;

/** Server options from environment variables (see .env.example). */
export function serverOptionsFromEnv(env: Record<string, string | undefined> = process.env): JobPaperServerOptions {
  sharedStore ??= createSettingsStore(env);
  return {
    store: sharedStore,
    html: PANEL_HTML,
    iconSvg: ICON_SVG,
    devUserId: env.JOBPAPER_DEV_USER || undefined,
    photoDomains: (env.JOBPAPER_PHOTO_DOMAINS ?? "https://*.oaiusercontent.com,https://*.openai.com")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}
