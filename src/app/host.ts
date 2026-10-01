import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from "@openai/mcp-extensions/app";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Thin wrapper over the MCP Apps bridge + OpenAI extensions, so components
// never touch protocol details. Every call degrades gracefully when the host
// lacks a capability (older clients, mobile, or the standalone preview).

export type McpUiHostContext = NonNullable<ReturnType<App["getHostContext"]>>;

export type DisplayMode = "inline" | "fullscreen" | "pip";

export interface HostEvents {
  onToolInput?: (args: Record<string, unknown>) => void;
  onToolResult?: (result: CallToolResult) => void;
  onContext?: (ctx: McpUiHostContext) => void;
}

export class Host {
  readonly app: App;
  readonly openai: OpenAIExtensions;
  connected = false;
  private context: McpUiHostContext = {};

  constructor(events: HostEvents) {
    this.app = new App({ name: "JobPaper", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
    this.openai = new OpenAIExtensions(this.app);
    // Register before connect so the initial tool input/result isn't missed.
    this.app.ontoolinput = (params) => events.onToolInput?.((params.arguments ?? {}) as Record<string, unknown>);
    this.app.ontoolresult = (result) => events.onToolResult?.(result as CallToolResult);
    this.app.addEventListener("hostcontextchanged", (ctx) => {
      this.context = { ...this.context, ...ctx };
      applyContext(ctx);
      events.onContext?.(this.context);
    });
  }

  async connect(): Promise<void> {
    await this.app.connect();
    this.connected = true;
    this.context = this.app.getHostContext() ?? {};
    applyContext(this.context);
  }

  get hostContext(): McpUiHostContext {
    return this.context;
  }

  get displayMode(): DisplayMode {
    return (this.context.displayMode as DisplayMode) ?? "inline";
  }

  get canFullscreen(): boolean {
    const modes = this.context.availableDisplayModes;
    return !modes || modes.includes("fullscreen");
  }

  async requestDisplayMode(mode: DisplayMode): Promise<boolean> {
    try {
      const res = await this.app.requestDisplayMode({ mode });
      return res.mode === mode;
    } catch {
      return false;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.app.callServerTool({ name, arguments: args })) as CallToolResult;
  }

  /** Keep the model's view of the document current ("what's the total now?"). */
  async updateModelContext(text: string, structured: Record<string, unknown>, resource?: { uri: string; name: string; text: string }) {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text, annotations: { audience: ["assistant"] } },
    ];
    if (resource) {
      content.push({
        type: "resource",
        resource: { uri: resource.uri, mimeType: "application/json", text: resource.text },
        annotations: { audience: ["assistant"] },
      });
    }
    const params = { content, structuredContent: structured } as Parameters<App["updateModelContext"]>[0];
    try {
      if (this.openai.modelContext) await this.openai.modelContext.update(params);
      else await this.app.updateModelContext(params);
    } catch {
      // Not supported here; the panel still works.
    }
  }

  async sendMessage(text: string): Promise<boolean> {
    try {
      const params = { role: "user" as const, content: [{ type: "text" as const, text }] };
      if (this.openai.message) await this.openai.message.send(params);
      else await this.app.sendMessage(params);
      return true;
    } catch {
      return false;
    }
  }

  /** Ask the host to save a file to the device. Returns false if unsupported or cancelled. */
  async downloadFile(name: string, mimeType: string, data: { text: string } | { blob: string }): Promise<boolean> {
    if (!this.app.getHostCapabilities()?.downloadFile) return false;
    try {
      const res = await this.app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: { uri: `file:///${encodeURIComponent(name)}`, mimeType, ...data },
          },
        ],
      });
      return !res.isError;
    } catch (error) {
      console.warn("JobPaper: host download failed", error);
      return false;
    }
  }

  async openLink(url: string): Promise<boolean> {
    try {
      const res = await this.app.openLink({ url });
      return !res.isError;
    } catch {
      return false;
    }
  }

  /** Read a resource: host files (file entrypoint) first, then our own server. */
  async readResource(uri: string, representation?: "text" | "blob") {
    if (this.openai.resources) {
      try {
        const res = await this.openai.resources.read({ uri, ...(representation ? { representation } : {}) });
        return res.contents[0];
      } catch (error) {
        console.warn("JobPaper: host resource read failed", uri, error);
      }
    }
    const res = await this.app.readServerResource({ uri });
    return res.contents[0] as (typeof res.contents)[number] & { openaiMetadata?: { etag?: string; writable?: boolean } };
  }

  async writeResource(uri: string, text: string, etag?: string) {
    if (!this.openai.resources) return null;
    return this.openai.resources.write(uri, { text, ...(etag ? { ifMatch: etag } : {}) });
  }
}

function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

export function parseFileInput(args: Record<string, unknown>) {
  const parsed = OpenAIFileEntrypointInputSchema.safeParse(args);
  return parsed.success ? parsed.data.file : null;
}

/** Decode base64 content from a resource read into text. */
export function contentText(content: { text?: string; blob?: string } | undefined): string | null {
  if (!content) return null;
  if (typeof content.text === "string") return content.text;
  if (typeof content.blob === "string") {
    const bin = atob(content.blob);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return null;
}
