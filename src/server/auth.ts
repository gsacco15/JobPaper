import { createClerkClient } from "@clerk/backend";

export const JOBPAPER_SCOPE = "jobpaper";

export interface McpAuthentication {
  resource: string;
  issuer: string;
  /** Returns only an identity verified against this Clerk instance. */
  verify(request: Request): Promise<string | null>;
  configured: boolean;
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Authentication URLs must be HTTPS URLs without credentials or query strings.");
  }
  return url;
}

/** Vercel deployments always require OAuth; local development can use the inspector. */
export function authenticationFromEnv(env: Record<string, string | undefined>): McpAuthentication | undefined {
  if (env.VERCEL !== "1" && env.JOBPAPER_AUTH_REQUIRED !== "true") return undefined;

  const resource = env.JOBPAPER_MCP_RESOURCE_URL ??
    (env.VERCEL_ENV === "preview" && env.VERCEL_URL ? `https://${env.VERCEL_URL}/mcp` : "https://jobpaperapp.com/mcp");
  const publishableKey = env.CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const keyHost = publishableKey && /^pk_(live|test)_[A-Za-z0-9_-]+$/.test(publishableKey)
    ? Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64url").toString().replace(/\$$/, "") : undefined;
  const issuer = env.JOBPAPER_CLERK_ISSUER ?? (keyHost ? `https://${keyHost}` : "https://clerk.jobpaperapp.com");
  const unavailable: McpAuthentication = { resource, issuer, configured: false, verify: async () => null };
  if (!env.CLERK_SECRET_KEY || !publishableKey) return unavailable;

  try {
    const issuerUrl = httpsUrl(issuer);
    const resourceUrl = httpsUrl(resource);
    if (issuerUrl.pathname !== "/" || resourceUrl.pathname !== "/mcp") return unavailable;
    // The public discovery issuer and the instance used for verification must agree.
    if (keyHost !== issuerUrl.hostname) return unavailable;
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey });
    return {
      resource: resourceUrl.href,
      issuer: issuerUrl.origin,
      configured: true,
      async verify(request) {
        // Cookies, MCP metadata, ID tokens, and developer IDs are never identities here.
        const bearer = /^Bearer ([^\s,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!bearer) return null;
        try {
          // Clerk's instance-scoped OAuth verification endpoint checks the access token,
          // including opaque token revocation. The SDK also requires the exact audience.
          const token = await clerk.idPOAuthAccessToken.verify(bearer, { audience: resourceUrl.href });
          if (token.revoked || token.expired || !token.subject.startsWith("user_") ||
              !token.scopes.includes(JOBPAPER_SCOPE) || !token.aud?.includes(resourceUrl.href) ||
              (token.expiration !== null && token.expiration * 1000 <= Date.now())) return null;
          return token.subject;
        } catch {
          // Do not log bearer tokens or provider responses that could contain credentials.
          return null;
        }
      },
    };
  } catch {
    return unavailable;
  }
}

export function metadataUrl(auth: McpAuthentication): string {
  return `${new URL(auth.resource).origin}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(auth: McpAuthentication | undefined): Response {
  if (!auth) return Response.json({ error: "OAuth is not configured." }, { status: 404 });
  if (!auth.configured) return Response.json({ error: "Sign-in setup is incomplete." }, { status: 503 });
  return Response.json({
    resource: auth.resource,
    resource_name: "JobPaper",
    authorization_servers: [auth.issuer],
    scopes_supported: [JOBPAPER_SCOPE],
    bearer_methods_supported: ["header"],
  }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}

export function authenticationChallenge(auth: McpAuthentication): Response {
  if (!auth.configured) return Response.json({ error: "Sign-in setup is incomplete." }, { status: 503 });
  return Response.json({ error: "Sign in to JobPaper to continue." }, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl(auth)}", scope="${JOBPAPER_SCOPE}"`,
      "Cache-Control": "no-store",
    },
  });
}
