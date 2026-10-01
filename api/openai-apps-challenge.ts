// OpenAI plugin domain verification: https://jobpaperapp.com/.well-known/openai-apps-challenge
// Paste the token from the OpenAI Platform into the Vercel env var OPENAI_APPS_CHALLENGE.
// Returns only the exact token as plain text.
export function GET(): Response {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? "").trim();
  if (!token) return new Response("Not configured", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(token, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
