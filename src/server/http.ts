import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createJobPaperServer, type JobPaperServerOptions } from "./server.js";
import { authenticationChallenge } from "./auth.js";

// Stateless Streamable HTTP: one server + transport per request, no sessions,
// nothing kept between calls. Works on Vercel, Cloudflare Workers, or Node.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate",
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
  if (options.requirePersistentSettings && options.store.kind === "memory") {
    return withCors(Response.json({ error: "Business settings storage is not configured." }, { status: 503 }));
  }
  let verifiedUserId: string | undefined;
  if (options.authentication) {
    const auth = options.authentication;
    if (!auth.configured) return withCors(authenticationChallenge(auth));
    try {
      verifiedUserId = (await auth.verify(request)) ?? undefined;
    } catch {
      return withCors(Response.json({ error: "Sign-in service unavailable. Try again." }, { status: 503 }));
    }
    if (!verifiedUserId) return withCors(authenticationChallenge(auth));
  }
  // Always replace any caller-supplied option with the identity for this request.
  const server = createJobPaperServer({ ...options, verifiedUserId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    if (options.authentication && response.headers.get("content-type")?.includes("application/json")) {
      // SDK 1.x preserves auth schemes in _meta but doesn't expose a registerTool
      // option for the top-level field expected by newer hosts. Advertise both.
      const body = await response.clone().json();
      if (Array.isArray(body?.result?.tools)) {
        body.result.tools = body.result.tools.map((tool: Record<string, any>) => ({
          ...tool, securitySchemes: tool._meta?.securitySchemes,
        }));
        return withCors(Response.json(body, { status: response.status, headers: response.headers }));
      }
    }
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
