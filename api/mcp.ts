// Vercel function: https://<your-app>.vercel.app/mcp (rewritten here by vercel.json).
import { serverOptionsFromEnv } from "../src/server/config.js";
import { handleMcpRequest } from "../src/server/http.js";

const handle = (request: Request) => handleMcpRequest(request, serverOptionsFromEnv());

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
