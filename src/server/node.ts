// Local / container entry: node dist/server.mjs  (PORT defaults to 8787).
// For ChatGPT developer mode, expose it with a tunnel and connect to /mcp.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { serverOptionsFromEnv } from "./config.js";
import { handleMcpRequest } from "./http.js";
import { protectedResourceMetadata } from "./auth.js";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, { method: req.method, headers, body });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const options = serverOptionsFromEnv();
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname)) {
      if (req.method !== "GET") return send(res, new Response("Method not allowed", { status: 405 }));
      return send(res, protectedResourceMetadata(options.authentication));
    }
    if (url.pathname === "/" || url.pathname === "/healthz") {
      return send(res, Response.json({ name: "JobPaper", status: "ok", mcp: "/mcp" }));
    }
    if (url.pathname !== "/mcp") return send(res, new Response("Not found", { status: 404 }));
    await send(res, await handleMcpRequest(await toRequest(req), options));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
}).listen(port, () => {
  console.log(`JobPaper MCP server on http://localhost:${port}/mcp (settings store: ${options.store.kind})`);
});
