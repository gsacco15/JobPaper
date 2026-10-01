import { completeSettings, type BusinessSettings } from "../shared/settings.js";

export { completeSettings };

// Business defaults are the only thing JobPaper keeps server-side. They're
// keyed by a SHA-256 hash of ChatGPT's anonymized user id (_meta["openai/subject"]),
// so the store never sees who the user is. Job text and photos are never stored.

export interface SettingsStore {
  readonly kind: string;
  get(userKey: string): Promise<Partial<BusinessSettings> | null>;
  set(userKey: string, values: BusinessSettings): Promise<void>;
}

export class MemorySettingsStore implements SettingsStore {
  readonly kind = "memory";
  private readonly data = new Map<string, BusinessSettings>();
  async get(userKey: string) {
    return this.data.get(userKey) ?? null;
  }
  async set(userKey: string, values: BusinessSettings) {
    this.data.set(userKey, { ...values });
  }
}

/** Upstash Redis / Vercel KV over REST — works from any serverless runtime. */
export class RestKvSettingsStore implements SettingsStore {
  readonly kind = "rest-kv";
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Settings storage returned ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(`Settings storage error: ${body.error}`);
    return body.result;
  }

  async get(userKey: string) {
    const raw = await this.command(["GET", `settings:${userKey}`]);
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as Partial<BusinessSettings>;
    } catch {
      return null;
    }
  }

  async set(userKey: string, values: BusinessSettings) {
    await this.command(["SET", `settings:${userKey}`, JSON.stringify(values)]);
  }
}

export function createSettingsStore(env: Record<string, string | undefined> = process.env): SettingsStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RestKvSettingsStore(url, token);
  return new MemorySettingsStore();
}

export async function hashUserId(subject: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jobpaper:${subject}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The user's storage key, or null when the host sent no user id. Without a key
 * settings fall back to defaults and updates are refused rather than shared.
 */
export async function userKeyFromMeta(meta: Record<string, unknown> | undefined): Promise<string | null> {
  const subject = meta?.["openai/subject"];
  if (typeof subject === "string" && subject.trim()) return hashUserId(subject.trim());
  return null;
}
