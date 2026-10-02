import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { authenticationFromEnv, protectedResourceMetadata } from "../src/server/auth.js";
import { handleMcpRequest } from "../src/server/http.js";
import { MemorySettingsStore } from "../src/server/settings-store.js";
import type { JobPaperServerOptions } from "../src/server/server.js";

const { verify, createClient } = vi.hoisted(() => {
  const verify = vi.fn();
  return { verify, createClient: vi.fn(() => ({ idPOAuthAccessToken: { verify } })) };
});
vi.mock("@clerk/backend", () => ({ createClerkClient: createClient }));

const resource = "https://jobpaperapp.com/mcp";
const env = {
  VERCEL: "1", CLERK_SECRET_KEY: "sk_test_fixture",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("clerk.jobpaperapp.com$").toString("base64url")}`,
};
const validToken = (subject = "user_a") => ({
  subject, scopes: ["jobpaper"], aud: [resource], revoked: false, expired: false,
  expiration: Math.floor(Date.now() / 1000) + 600,
});
const request = (token?: string) => new Request(resource, {
  method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},
});

beforeEach(() => { vi.clearAllMocks(); verify.mockResolvedValue(validToken()); });

describe("Clerk OAuth verification", () => {
  it("verifies only the explicit bearer access token against the configured instance and exact resource", async () => {
    const auth = authenticationFromEnv(env)!;
    expect(await auth.verify(request("opaque-access-token"))).toBe("user_a");
    expect(createClient).toHaveBeenCalledWith({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
    expect(verify).toHaveBeenCalledWith("opaque-access-token", { audience: resource });
    expect(await auth.verify(new Request(resource, { headers: { Cookie: "__session=some-session" } }))).toBeNull();
    expect(await auth.verify(request())).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["revoked", { revoked: true }], ["expired flag", { expired: true }],
    ["expired timestamp", { expiration: 1 }], ["missing permission", { scopes: ["profile"] }],
    ["missing audience", { aud: undefined }], ["wrong audience", { aud: ["https://other.example/mcp"] }],
    ["machine identity", { subject: "mch_a" }],
  ])("rejects %s before any settings access", async (_label, override) => {
    verify.mockResolvedValue({ ...validToken(), ...override });
    expect(await authenticationFromEnv(env)!.verify(request("token"))).toBeNull();
  });

  it("fails closed when Clerk rejects an invalid token or a token from another instance", async () => {
    verify.mockRejectedValue(new Error("provider rejected token"));
    expect(await authenticationFromEnv(env)!.verify(request("foreign-token"))).toBeNull();
  });

  it("requires authentication on Vercel even when configuration is missing or an opt-out is supplied", () => {
    expect(authenticationFromEnv({ VERCEL: "1", JOBPAPER_AUTH_REQUIRED: "false" })?.configured).toBe(false);
    expect(authenticationFromEnv({ ...env, JOBPAPER_CLERK_ISSUER: "https://other.example" })?.configured).toBe(false);
    expect(authenticationFromEnv({ ...env, JOBPAPER_MCP_RESOURCE_URL: "http://jobpaperapp.com/mcp" })?.configured).toBe(false);
    expect(authenticationFromEnv({ JOBPAPER_DEV_USER: "local" })).toBeUndefined();
  });
  it("uses the preview deployment's resource and Clerk instance rather than accepting production tokens there", () => {
    const previewHost = "sample.clerk.accounts.dev";
    const auth = authenticationFromEnv({ ...env, VERCEL_ENV: "preview", VERCEL_URL: "preview.example.com",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${previewHost}$`).toString("base64url")}` })!;
    expect(auth.resource).toBe("https://preview.example.com/mcp");
    expect(auth.issuer).toBe(`https://${previewHost}`);
    expect(auth.configured).toBe(true);
  });
});

describe("authenticated MCP boundary", () => {
  function options(): JobPaperServerOptions {
    return { store: new MemorySettingsStore(), html: "panel", iconSvg: "<svg/>",
      authentication: authenticationFromEnv(env), devUserId: "must-not-be-used" };
  }
  function clientFor(opts: JobPaperServerOptions, token: string, forgedSubject: string) {
    const wire: { tools?: Array<Record<string, any>> } = {};
    const transport = new StreamableHTTPClientTransport(new URL(resource), { fetch: async (url, init) => {
      let body = init?.body;
      if (typeof body === "string") {
        const message = JSON.parse(body);
        if (message.params) message.params._meta = { "openai/subject": forgedSubject };
        body = JSON.stringify(message);
      }
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      const response = await handleMcpRequest(new Request(url as string, { ...init, body, headers }), opts);
      if (typeof body === "string" && JSON.parse(body).method === "tools/list") {
        wire.tools = (await response.clone().json()).result?.tools;
      }
      return response;
    } });
    const client = new Client({ name: "auth-test", version: "1" });
    return { client, transport, wire };
  }
  it("returns discovery and a 401 challenge without accepting forged metadata or a developer identity", async () => {
    const opts = options();
    const response = await handleMcpRequest(request(), opts);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('/.well-known/oauth-protected-resource/mcp');
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    expect(await protectedResourceMetadata(opts.authentication).json()).toMatchObject({ resource, scopes_supported: ["jobpaper"], authorization_servers: ["https://clerk.jobpaperapp.com"] });
    expect((await handleMcpRequest(request("token"), { ...opts, authentication: authenticationFromEnv({ VERCEL: "1" }) })).status).toBe(503);
    expect((await handleMcpRequest(request("token"), { ...opts, requirePersistentSettings: true })).status).toBe(503);
  });

  it("persists and isolates verified accounts despite identical/spoofed host metadata, including after reconnection", async () => {
    verify.mockImplementation(async (token: string) => validToken(token === "token-b" ? "user_b" : "user_a"));
    const opts = options();
    const a = clientFor(opts, "token-a", "pretend-user-b");
    const b = clientFor(opts, "token-b", "pretend-user-b");
    await a.client.connect(a.transport); await b.client.connect(b.transport);
    try {
      const saved = await a.client.callTool({ name: "settings.update", arguments: { set: { business_name: "Sample A", default_markup_pct: 0 } } });
      expect(saved.isError).toBeFalsy();
      expect((await b.client.callTool({ name: "settings.read", arguments: {} })).structuredContent).toMatchObject({ values: { business_name: "" } });
      await b.client.callTool({ name: "settings.update", arguments: { set: { business_name: "Sample B" } } });
      const a2 = clientFor(opts, "refreshed-token-a", "completely-new-subject");
      await a2.client.connect(a2.transport);
      try {
        expect((await a2.client.callTool({ name: "settings.read", arguments: {} })).structuredContent).toMatchObject({ values: { business_name: "Sample A", default_markup_pct: 0 } });
        const { tools } = await a2.client.listTools();
        for (const tool of tools) {
          expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["jobpaper"] }]);
        }
        // SDK 1.x clients strip unknown top-level fields; inspect the actual wire response.
        for (const tool of a2.wire.tools!) expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["jobpaper"] }]);
        const estimate = await a2.client.callTool({ name: "create_estimate", arguments: { job_description: "Test", line_items: [{ name: "Labor", unit_price: 300 }] } });
        expect(estimate.structuredContent).toMatchObject({ document: { business: { name: "Sample A" }, totals: { total: 300 } } });
      } finally { await a2.client.close(); }
    } finally { await a.client.close(); await b.client.close(); }
  });

  it("does not silently generate a document with empty business defaults during a storage outage", async () => {
    const opts = options(); opts.store.get = async () => { throw new Error("test outage"); };
    const a = clientFor(opts, "token-a", "forged"); await a.client.connect(a.transport);
    try {
      const result = await a.client.callTool({ name: "create_estimate", arguments: { job_description: "Test", line_items: [{ name: "Labor", unit_price: 300 }] } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Business settings couldn't be loaded");
      expect(result.structuredContent).toBeUndefined();
    } finally { await a.client.close(); }
  });
});
