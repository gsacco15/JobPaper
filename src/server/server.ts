import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import {
  createSettings,
  OpenAIFileEntrypointInputSchema,
  type OpenAIUiResourceMetadata,
  type OpenAIUiToolMetadata,
} from "@openai/mcp-extensions/server";
import { z } from "zod";
import { buildChangeOrder, buildEstimate, buildJobReport, type BuildContext } from "../shared/build.js";
import { DOC_LABELS, type JobDocument } from "../shared/document.js";
import {
  decodeDocUri,
  DOC_URI_PREFIX,
  encodeDocUri,
  FILE_EXTENSIONS,
  fileNameFor,
  forStorage,
  isDocUri,
  resolveInlineDocument,
  serializeDocument,
} from "../shared/files.js";
import { MAX_LOGO_DATA_URL_LENGTH, type BusinessSettings } from "../shared/settings.js";
import { formatMoney, formatSignedMoney } from "../shared/totals.js";
import { modelSummary } from "../shared/text.js";
import { completeSettings, userKeyFromMeta, type SettingsStore } from "./settings-store.js";

export const UI_URI = "ui://jobpaper/document-v1";
export const SERVER_NAME = "jobpaper";
export const SERVER_VERSION = "1.0.0";

export interface JobPaperServerOptions {
  store: SettingsStore;
  /** The bundled panel (single self-contained HTML file). */
  html: string;
  iconSvg: string;
  /** Used when the host sends no user id (local development only). */
  devUserId?: string;
  /** Extra image origins the panel may load photos from. */
  photoDomains?: string[];
}

type Meta = Record<string, unknown> | undefined;

// Every document tool only builds and returns a document. Nothing is written
// anywhere and nothing outside this server is contacted, so all three are
// read-only, non-destructive, and closed-world.
const DOC_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
} as const;

const lineItemSchema = z.object({
  id: z.string().optional().describe("Leave out for new lines."),
  name: z.string().describe("Plain-English line, like a text to the customer: \"Demo existing tile and vanity\"."),
  qty: z.number().nonnegative().optional().describe("Defaults to 1."),
  unit: z.string().optional().describe("One of: job, hr, sq ft, ln ft, each. Defaults to job."),
  unit_price: z.number().nonnegative().optional().describe("Price per unit in dollars, rounded to the dollar."),
});

const photoSchema = z.union([
  z.string().describe("Image URI the user attached."),
  z.object({
    uri: z.string().optional().describe("Image URI the user attached."),
    download_url: z.string().optional(),
    file_id: z.string().optional(),
    caption: z.string().optional().describe("Short caption from the user's notes."),
    area: z.string().optional().describe("Area of the job, used to group photos (\"Kitchen\", \"Roof - north side\")."),
  }),
]);

function fail(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function closingLine(doc: JobDocument): string {
  if (doc.doc_type === "change_order" && doc.change) {
    return `CO-${doc.change.sequence}: net change ${formatSignedMoney(doc.change.net_change)}, new contract total ${formatMoney(doc.change.new_total)}.`;
  }
  if (doc.doc_type === "job_report") return `${DOC_LABELS[doc.doc_type]} ready with ${doc.photos.length} photo(s).`;
  return `Total ${formatMoney(doc.totals.total)}.`;
}

/** The document result: model-facing summary + file link, panel-only extras in _meta. */
export function documentResult(doc: JobDocument, logo: string): CallToolResult {
  const stored = forStorage(doc);
  const uri = encodeDocUri(doc);
  const name = fileNameFor(doc);
  return {
    content: [
      {
        type: "text",
        text:
          `${modelSummary(doc)}\n` +
          `Saved as file ${name} (resource URI below — pass it as estimate_file to make a change order). ` +
          `Tell the user in one line: "${closingLine(doc)} Tap any line to edit, Download PDF when ready." Do not repeat the line items.`,
      },
      { type: "resource_link", uri, name, title: doc.title, mimeType: "application/json" },
    ],
    structuredContent: { document: stored, file: { name, uri } },
    _meta: { "jobpaper/logo": logo, "jobpaper/hints": doc.hints ?? [] },
  };
}

export function createJobPaperServer(opts: JobPaperServerOptions): McpServer {
  const iconSrc = "data:image/svg+xml," + encodeURIComponent(opts.iconSvg);
  const icon = { src: iconSrc, mimeType: "image/svg+xml", sizes: ["any"] };
  // Entrypoint tools carry an icon; spread so the tool config type accepts it.
  const iconProps = { icons: [icon] };
  const server = new McpServer({
    name: SERVER_NAME,
    title: "JobPaper",
    version: SERVER_VERSION,
    icons: [icon],
    websiteUrl: "https://jobpaper.app",
  });

  async function userKey(meta: Meta): Promise<string | null> {
    return (await userKeyFromMeta(meta)) ?? (opts.devUserId ? `dev:${opts.devUserId}` : null);
  }

  async function loadSettings(meta: Meta): Promise<BusinessSettings> {
    const key = await userKey(meta);
    if (!key) return completeSettings(null);
    try {
      return completeSettings(await opts.store.get(key));
    } catch (error) {
      console.error("settings read failed", error);
      return completeSettings(null);
    }
  }

  async function saveSettings(meta: Meta, set: Partial<BusinessSettings>): Promise<BusinessSettings> {
    const key = await userKey(meta);
    if (!key) throw new Error("JobPaper couldn't tell which account to save settings for. Please try again from ChatGPT.");
    const next = completeSettings({ ...(await loadSettings(meta)), ...set });
    await opts.store.set(key, next);
    return next;
  }

  const context = (settings: BusinessSettings, meta: Meta): BuildContext => ({
    settings,
    timeZone: typeof meta?.["openai/timezone"] === "string" ? (meta["openai/timezone"] as string) : undefined,
  });

  // ---- Panel resource ------------------------------------------------------

  registerAppResource(server, "JobPaper document", UI_URI, { description: "Estimate, change order, and job report panel." }, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: opts.html,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: opts.photoDomains ?? [] },
            permissions: { clipboardWrite: {} },
          },
          "openai/ui": {
            availableDisplayModes: ["inline", "fullscreen"],
            preferredDisplayMode: "inline",
          } satisfies OpenAIUiResourceMetadata,
        },
      },
    ],
  }));

  // Saved documents that live inside their own URI (jobpaper://doc/<name>?d=...).
  server.registerResource(
    "Saved JobPaper document",
    new ResourceTemplate(`${DOC_URI_PREFIX}{name}{?d}`, { list: undefined }),
    { mimeType: "application/json", description: "An estimate, change order, or job report saved by JobPaper." },
    async (uri) => {
      const doc = decodeDocUri(uri.href);
      if (!doc) throw new Error("That JobPaper file couldn't be read.");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: serializeDocument(doc) }] };
    },
  );

  const docUi = { ui: { resourceUri: UI_URI } };

  // ---- create_estimate -----------------------------------------------------

  registerAppTool(
    server,
    "create_estimate",
    {
      title: "Create estimate",
      description:
        "Turn a contractor's job description into a customer-ready estimate with an editable line-item panel and PDF. " +
        "Use when the user asks to \"write up an estimate for…\", \"put together a quote for…\", \"bid for a…\", or \"price out a…\" a job " +
        "(remodel, bathroom, kitchen, roof, fence, deck, drywall, paint, HVAC, plumbing, electrical, landscaping, concrete, flooring, tile). " +
        "Before calling, draft 3–10 plain-English line_items from the description (labor and materials split only when the user mentions both; " +
        "units job, hr, sq ft, ln ft, or each; prices rounded to the dollar). Never compute totals — the server does the math from the user's settings.",
      inputSchema: z.object({
        job_description: z.string().describe("What the job is, in the user's words."),
        line_items: z.array(lineItemSchema).max(40).optional().describe("3–10 drafted lines."),
        client_name: z.string().optional(),
        job_address_text: z.string().optional().describe("Only if the user typed it. Never look up or infer a location."),
        notes: z.string().optional().describe("Assumptions or exclusions worth showing the customer."),
      }),
      annotations: { ...DOC_TOOL_ANNOTATIONS, title: "Create estimate" },
      _meta: docUi,
    },
    async (input, extra) => {
      if (!input.job_description?.trim()) {
        return fail("No job description. Ask the user one question: what's the job?");
      }
      if (!input.line_items?.length) {
        return fail(
          "No line items. Draft 3–10 plain-English line items (name, qty, unit, unit_price) from the job description, then call create_estimate again with them. Don't ask the user first.",
        );
      }
      const settings = await loadSettings(extra._meta);
      const doc = buildEstimate(input, context(settings, extra._meta));
      return documentResult(doc, settings.logo_data_url);
    },
  );

  // ---- create_change_order ------------------------------------------------

  registerAppTool(
    server,
    "create_change_order",
    {
      title: "Create change order",
      description:
        "Make a change order against a saved JobPaper estimate: \"change order for…\", \"the customer added…\", \"they want to add… to the job\". " +
        "estimate_file is the resource URI of the saved .est.json file (or the latest .co.json for that job, so numbering continues CO-1, CO-2). " +
        "The original total is read from the file, never retyped. If there is no estimate file to reference, ask the user for it instead of calling this.",
      inputSchema: z.object({
        estimate_file: z.string().describe("Resource URI of the saved estimate (or latest change order) file."),
        change_description: z.string().describe("What changed, in plain English."),
        added_items: z.array(lineItemSchema).max(40).optional().describe("New lines this change adds."),
        removed_item_ids: z.array(z.string()).max(40).optional().describe("Ids (li_N) of estimate lines this change removes."),
        schedule_impact_days: z.number().int().min(-365).max(365).optional().describe("Extra days (negative if shorter)."),
      }),
      annotations: { ...DOC_TOOL_ANNOTATIONS, title: "Create change order" },
      _meta: docUi,
    },
    async (input, extra) => {
      if (!input.change_description?.trim()) {
        return fail("No change description. Ask the user one question: what changed?");
      }
      const ref = input.estimate_file?.trim() ?? "";
      if (!ref) return fail("No estimate file. Ask the user which estimate this change order is for.");
      const settings = await loadSettings(extra._meta);
      const source = resolveInlineDocument(ref);
      if (!source) {
        // A host file URI: the server can't read it, but the panel can. It loads
        // the file and finishes the change order with the same math.
        return {
          content: [
            {
              type: "text",
              text: "Opening the estimate file in the JobPaper panel to finish this change order. Tell the user: \"Tap any line to edit, Download PDF when ready.\"",
            },
          ],
          structuredContent: { pending: { estimate_file: ref, input } },
          _meta: { "jobpaper/logo": settings.logo_data_url, "jobpaper/settings": settings },
        };
      }
      if (source.doc_type === "job_report") {
        return fail("That file is a job report. A change order needs the estimate file (.est.json) for this job.");
      }
      const estimateUri =
        source.doc_type === "estimate"
          ? isDocUri(ref)
            ? ref
            : encodeDocUri(source)
          : (source.references.source_uri ?? null);
      const doc = buildChangeOrder(source, input, context(settings, extra._meta), estimateUri ?? undefined);
      return documentResult(doc, settings.logo_data_url);
    },
  );

  // ---- create_job_report ---------------------------------------------------

  registerAppTool(
    server,
    "create_job_report",
    {
      title: "Create job report",
      description:
        "Turn the user's notes and attached photos into a daily or weekly job report for the homeowner: \"daily report for the … job\", " +
        "\"job report from these photos\", \"end of day report\", \"weekly update for the homeowner\". Only use photos the user attached. " +
        "Caption photos from the user's notes and set area so photos group by area; put issues and next steps in their own fields.",
      inputSchema: z.object({
        job_name: z.string().describe("Job or customer name."),
        period: z.enum(["daily", "weekly"]).optional(),
        notes: z.string().describe("Work done, in plain customer-facing English."),
        photos: z.array(photoSchema).max(40).optional(),
        crew_count: z.number().int().nonnegative().optional(),
        hours: z.number().nonnegative().optional(),
        weather_text: z.string().optional().describe("Only if the user mentioned it."),
        issues: z.string().optional(),
        next_steps: z.string().optional(),
      }),
      annotations: { ...DOC_TOOL_ANNOTATIONS, title: "Create job report" },
      _meta: docUi,
    },
    async (input, extra) => {
      if (!input.job_name?.trim()) return fail("No job name. Ask the user which job this report is for.");
      if (!input.notes?.trim() && !input.photos?.length) {
        return fail("No notes or photos. Ask the user what got done today.");
      }
      const settings = await loadSettings(extra._meta);
      const photos = (input.photos ?? []).map((p) =>
        typeof p === "string" ? p : { uri: p.uri ?? p.download_url ?? "", caption: p.caption, area: p.area },
      );
      const doc = buildJobReport({ ...input, notes: input.notes ?? "", photos }, context(settings, extra._meta));
      return documentResult(doc, settings.logo_data_url);
    },
  );

  // ---- Entrypoints ---------------------------------------------------------

  registerAppTool(
    server,
    "open_jobpaper",
    {
      title: "Job Papers",
      description: "Open JobPaper to start an estimate, change order, or job report, or reopen a saved one.",
      ...iconProps,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: "Job Papers" },
      _meta: {
        ui: { resourceUri: UI_URI, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] } satisfies OpenAIUiToolMetadata,
      },
    },
    async (_input, extra) => {
      const settings = await loadSettings(extra._meta);
      return {
        content: [{ type: "text", text: "JobPaper home." }],
        structuredContent: { view: "home" },
        _meta: { "jobpaper/logo": settings.logo_data_url, "jobpaper/settings": settings },
      };
    },
  );

  registerAppTool(
    server,
    "open_document_file",
    {
      title: "JobPaper viewer",
      description: "Open a saved JobPaper estimate, change order, or job report file.",
      ...iconProps,
      inputSchema: OpenAIFileEntrypointInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: "JobPaper viewer" },
      _meta: {
        ui: { resourceUri: UI_URI, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: "file", extensions: FILE_EXTENSIONS }] } satisfies OpenAIUiToolMetadata,
      },
    },
    async (input, extra) => {
      const { file } = input as z.infer<typeof OpenAIFileEntrypointInputSchema>;
      const settings = await loadSettings(extra._meta);
      const inline = decodeDocUri(file.resourceUri);
      return {
        content: [{ type: "text", text: `Opened ${file.name}.` }],
        structuredContent: { view: "file", file, ...(inline ? { document: forStorage(inline) } : {}) },
        _meta: { "jobpaper/logo": settings.logo_data_url, "jobpaper/settings": settings },
      };
    },
  );

  // ---- Settings (plugin settings extension) --------------------------------

  createSettings(server).register({
    fields: {
      business_name: { schema: z.string().max(120), title: "Business name" },
      phone: { schema: z.string().max(40), title: "Phone" },
      email: { schema: z.string().max(120), title: "Email" },
      default_markup_pct: { schema: z.number().min(0).max(100), title: "Default markup %" },
      default_tax_pct: { schema: z.number().min(0).max(100), title: "Sales tax %" },
      default_terms: {
        schema: z.string().max(2000),
        title: "Payment terms",
        description: "Editable sample terms printed on estimates. Not legal advice.",
      },
    },
    layout: [
      {
        kind: "group",
        title: "Your business",
        items: [
          { kind: "property", property: "business_name" },
          { kind: "property", property: "phone" },
          { kind: "property", property: "email" },
          { kind: "tool", tool: "edit_logo", title: "Logo", description: "Add or change the logo printed on your PDFs" },
        ],
      },
      {
        kind: "group",
        title: "Estimate defaults",
        items: [
          { kind: "property", property: "default_markup_pct" },
          { kind: "property", property: "default_tax_pct" },
          { kind: "property", property: "default_terms" },
        ],
      },
    ],
    read: async (extra) => {
      const { logo_data_url: _logo, ...values } = await loadSettings(extra._meta);
      return values;
    },
    update: async (set, extra) => {
      const { logo_data_url: _logo, ...values } = await saveSettings(extra._meta, set);
      return values;
    },
  });

  registerAppTool(
    server,
    "edit_logo",
    {
      title: "Logo",
      description: "Add or change the logo printed on JobPaper PDFs.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    async (_input, extra) => {
      const settings = await loadSettings(extra._meta);
      return {
        content: [{ type: "text", text: "Logo settings." }],
        structuredContent: { view: "logo" },
        _meta: { "jobpaper/logo": settings.logo_data_url, "jobpaper/settings": settings },
      };
    },
  );

  // Panel-only helpers. Not visible to the model.
  registerAppTool(
    server,
    "save_logo",
    {
      title: "Save logo",
      inputSchema: z.object({ logo_data_url: z.string().max(MAX_LOGO_DATA_URL_LENGTH) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ logo_data_url }, extra) => {
      if (logo_data_url && !/^data:image\/(png|jpeg|webp);base64,/.test(logo_data_url)) {
        return fail("Logo must be a PNG, JPEG, or WebP image.");
      }
      const saved = await saveSettings(extra._meta, { logo_data_url });
      return { content: [{ type: "text", text: saved.logo_data_url ? "Logo saved." : "Logo removed." }], structuredContent: { saved: true } };
    },
  );

  registerAppTool(
    server,
    "get_settings",
    {
      title: "Get business settings",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (_input, extra) => {
      const settings = await loadSettings(extra._meta);
      return { content: [], structuredContent: { settings } };
    },
  );

  return server;
}
