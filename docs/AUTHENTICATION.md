# JobPaper account authentication and rollout

Vercel requests require a Clerk OAuth access token with scope `jobpaper` and an audience equal to this deployment's canonical `/mcp` URL. The server verifies tokens through the configured Clerk instance's Backend API, including opaque token revocation. Supplied `openai/subject`, cookies, and developer IDs cannot choose a public profile. Settings keys hash the Clerk issuer plus stable user ID; reconnecting the same account preserves settings. Production and development instances have separate profile namespaces.

The existing private desktop bridge has no Clerk token. Deploying this change requires reconnecting through an OAuth-capable host. Do not merge until that reconnection is prepared. Old private profiles are not automatically transferred by an unverified identifier; sign in and enter company details again, or perform a separately verified migration.

## Provider setup

- Clerk resource `jobpaper-sign-in`, Hobby plan, connected to Vercel project `job-paper`.
- Production domain `jobpaperapp.com`; issuer `https://clerk.jobpaperapp.com`.
- Add the five Clerk CNAME records shown in the provider dashboard and verify DNS and certificates.
- Create advertised scope `jobpaper`, describing document access and the signed-in user's business profile, logo, rates, and terms.
- Enable Publish CIMD support. Configure approved client admission deliberately: restricted admission needs the host's exact registered client metadata URL. Open admission also accepts unknown client-controlled metadata URLs and needs the owner's explicit approval.
- Require S256 PKCE, keep opaque tokens, enable Include Audience, and leave deprecated DCR disabled.
- Default scopes: `jobpaper` plus Clerk's required `offline_access`. Email/profile sharing is unnecessary for selecting the stored business profile.
- Confirm the Vercel integration supplied `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the correct environments, without exposing the secret in client code or screenshots.

## Deployment configuration

Vercel always requires authentication, even if `JOBPAPER_AUTH_REQUIRED=false`. Outside Vercel, set `JOBPAPER_AUTH_REQUIRED=true` to test OAuth; otherwise the local inspector uses existing development behavior.

The issuer comes from the trusted publishable key, or `JOBPAPER_CLERK_ISSUER` if explicitly supplied; a mismatch fails closed. The audience defaults to `https://jobpaperapp.com/mcp` in production and `https://<VERCEL_URL>/mcp` for previews. Override with `JOBPAPER_MCP_RESOURCE_URL` only for the deployment's real canonical resource. Preview clients must request the preview resource and use the preview Clerk instance. Never expose the Clerk secret key in the panel.

Discovery: `/.well-known/oauth-protected-resource/mcp` (also available at the root protected-resource URL). Invalid/missing credentials receive HTTP 401 with a discoverable WWW-Authenticate challenge. Incomplete auth or missing persistent storage receives 503. Tools advertise scope `jobpaper` in top-level `securitySchemes` and `_meta.securitySchemes`. The top-level field is promoted in the wire response for SDK 1.x compatibility.

## Verification before merge/public submission

- [ ] Production provider DNS verified and HTTPS certificates active.
- [ ] OAuth clients admitted using the approved policy.
- [ ] Credentials supplied by the integration for the intended environment.
- [ ] Preview deployment is ready; discovery issuer/audience/scopes are correct.
- [ ] In a real host, sign up/sign in, consent, save a fictional business profile, reconnect, and confirm it reloads.
- [ ] A second signed-in user sees a separate blank/default profile; editing B never changes A.
- [ ] An invalid/revoked token and a token for a different resource cannot read or write settings.
- [ ] An estimate uses the saved company details, zero-percent defaults, and chosen terms; PDF really saves.
- [ ] Prepare the existing private bridge reconnection before switching production.
- [ ] Run the iPhone checklist only in a connection eligible for mobile; an imported Desktop-only plugin remains ineligible.

Automated tests use controlled Clerk verification responses to cover the server trust boundary; they do not establish that a real host's OAuth signup, consent, refresh, or mobile experience works.
