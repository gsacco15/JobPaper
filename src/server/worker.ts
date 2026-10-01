// Cloudflare Workers entry (alternative to Vercel). See wrangler.toml.
import { ICON_SVG, PANEL_HTML } from "../generated/assets.js";
import { handleMcpRequest } from "./http.js";
import { createSettingsStore, type SettingsStore } from "./settings-store.js";

type Env = Record<string, string | undefined>;
let store: SettingsStore | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/healthz") return Response.json({ name: "JobPaper", status: "ok", mcp: "/mcp" });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    store ??= createSettingsStore(env);
    return handleMcpRequest(request, {
      store,
      html: PANEL_HTML,
      iconSvg: ICON_SVG,
      devUserId: env.JOBPAPER_DEV_USER || undefined,
      photoDomains: (env.JOBPAPER_PHOTO_DOMAINS ?? "https://*.oaiusercontent.com,https://*.openai.com").split(",").map((d) => d.trim()).filter(Boolean),
    });
  },
};
