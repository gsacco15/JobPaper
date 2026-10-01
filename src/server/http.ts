import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createJobPaperServer, type JobPaperServerOptions } from "./server.js";

// Stateless Streamable HTTP: one server + transport per request, no sessions,
// nothing kept between calls. Works on Vercel, Cloudflare Workers, or Node.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleMcpRequest(request: Request, options: JobPaperServerOptions): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method === "GET" && !(request.headers.get("accept") ?? "").includes("text/event-stream")) {
    return withCors(
      Response.json({ name: "JobPaper MCP server", status: "ok", store: options.store.kind, endpoint: "POST /mcp" }),
    );
  }
  if (request.method !== "POST") {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return withCors(
      Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405 }),
    );
  }
  const server = createJobPaperServer(options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response);
  } catch (error) {
    console.error("MCP request failed", error);
    return withCors(
      Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, { status: 500 }),
    );
  } finally {
    // JSON responses are fully buffered, so closing here is safe.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}
