// A stand-in for ChatGPT: renders the JobPaper panel in a sandboxed iframe,
// connects it with the MCP Apps AppBridge, and proxies to the real server.
// Records everything the panel asks the host to do on window.__host.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

type Recorded = { method: string; params: unknown };
const files = new Map<string, { text: string; etag: number; writable: boolean }>();
const log: Recorded[] = [];

const subject = new URLSearchParams(location.search).get("subject") ?? "v1/e2e-user";
const client = new Client({ name: "fake-chatgpt", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("/mcp", location.href), {
    fetch: async (input, init) => {
      let body = init?.body;
      if (typeof body === "string") {
        const msg = JSON.parse(body);
        if (msg.params && typeof msg.params === "object") msg.params._meta = { ...(msg.params._meta ?? {}), "openai/subject": subject };
        body = JSON.stringify(msg);
      }
      return fetch(input, { ...init, body });
    },
  }),
);

window.addEventListener("message", (e) => {
  if (e.data?.error) console.log("rpc error", JSON.stringify(e.data.error));
});
const ui = await client.readResource({ uri: "ui://jobpaper/document-v1" });
const html = (ui.contents[0] as { text: string }).text;

let bridge: AppBridge | null = null;
let displayMode: "inline" | "fullscreen" = "inline";

async function mount(mode: "inline" | "fullscreen") {
  document.getElementById("frame")?.remove();
  displayMode = mode;
  const iframe = document.createElement("iframe");
  iframe.id = "frame";
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
  iframe.style.cssText = "width:390px;height:800px;border:1px solid #ccc";
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  await new Promise((r) => iframe.addEventListener("load", r, { once: true }));

  bridge = new AppBridge(
    client,
    { name: "fake-chatgpt", version: "1.0.0" },
    {
      openLinks: {},
      downloadFile: {},
      serverTools: {},
      serverResources: {},
      updateModelContext: { text: {}, structuredContent: {}, resource: {} },
      message: { text: {} },
      experimental: { "openai/resource": {}, "openai/modelContext": {}, "openai/message": {} },
    },
    { hostContext: { theme: "light", displayMode: mode, availableDisplayModes: ["inline", "fullscreen"], platform: "mobile" } },
  );
  const record = (method: string) => async (params: unknown) => {
    log.push({ method, params });
    return {};
  };
  bridge.onupdatemodelcontext = record("ui/update-model-context") as never;
  bridge.onmessage = record("ui/message") as never;
  bridge.ondownloadfile = record("ui/download-file") as never;
  bridge.onopenlink = record("ui/open-link") as never;
  bridge.onrequestdisplaymode = async (params) => {
    log.push({ method: "ui/request-display-mode", params });
    displayMode = params.mode === "fullscreen" ? "fullscreen" : "inline";
    void bridge!.sendHostContextChange({ displayMode });
    return { mode: displayMode };
  };
  (bridge as unknown as { setRequestHandler: (schema: never, handler: never) => void }).setRequestHandler(
    z.object({ method: z.literal("openai/resources/write"), params: z.object({ uri: z.string(), text: z.string(), ifMatch: z.string().optional() }) }) as never,
    (async (req: { params: { uri: string; text: string; ifMatch?: string } }) => {
      log.push({ method: "openai/resources/write", params: req.params });
      const f = files.get(req.params.uri);
      if (!f) throw new Error("unknown file");
      if (req.params.ifMatch && req.params.ifMatch !== String(f.etag)) return { outcome: "conflict", etag: String(f.etag) };
      f.text = req.params.text;
      f.etag += 1;
      return { outcome: "saved", etag: String(f.etag) };
    }) as never,
  );
  const initialized = new Promise<void>((r) => (bridge!.oninitialized = () => r()));
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  // connect() installs default forwarding to the server; host files override it.
  bridge.onreadresource = async (params) => {
    const f = files.get(params.uri);
    if (f) {
      return {
        contents: [{ uri: params.uri, mimeType: "application/json", text: f.text, _meta: { "openai/resource": { etag: String(f.etag), writable: f.writable } } }],
      };
    }
    return client.readResource(params);
  };

  await initialized;
}

/** Simulate the model calling a tool: render the panel, send input + result. */
async function runTool(name: string, args: Record<string, unknown>, mode: "inline" | "fullscreen" = "inline") {
  const result = await client.callTool({ name, arguments: args });
  await mount(mode);
  await bridge!.sendToolInput({ arguments: args });
  await bridge!.sendToolResult(result as never);
  return result;
}

Object.assign(window, {
  __host: {
    log,
    files,
    runTool,
    callTool: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }),
    addFile: (uri: string, text: string, writable = true) => files.set(uri, { text, etag: 1, writable }),
    ready: true,
  },
});
