import { protectedResourceMetadata } from "../src/server/auth.js";
import { serverOptionsFromEnv } from "../src/server/config.js";

export function GET(): Response {
  return protectedResourceMetadata(serverOptionsFromEnv().authentication);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
