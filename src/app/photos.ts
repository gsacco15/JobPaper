import type { Host } from "./host.js";

// Photos are only ever the images the user attached. We display them by URI
// and, for the PDF, turn them into small JPEG data URLs on the device.

const MAX_SIDE = 1400;
const cache = new Map<string, Promise<string | null>>();

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

/** Downscale to a JPEG data URL. Throws if the canvas is tainted. */
export function toJpegDataUrl(img: HTMLImageElement, maxSide = MAX_SIDE, quality = 0.82): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

async function resolvePhoto(uri: string, host: Host | null): Promise<string | null> {
  if (uri.startsWith("data:image/")) {
    try {
      return toJpegDataUrl(await loadImage(uri, false));
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(uri)) {
    try {
      return toJpegDataUrl(await loadImage(uri, true));
    } catch {
      // CORS or CSP blocked; try through the host below.
    }
  }
  if (host?.connected) {
    try {
      const content = (await host.readResource(uri, "blob")) as { blob?: string; text?: string; mimeType?: string } | undefined;
      if (content?.blob) {
        const mime = content.mimeType?.startsWith("image/") ? content.mimeType : "image/jpeg";
        return toJpegDataUrl(await loadImage(`data:${mime};base64,${content.blob}`, false));
      }
    } catch {
      // fall through
    }
  }
  return null;
}

/** Cached: the same photo is only fetched once per panel. Null means it failed. */
export function photoData(uri: string, host: Host | null): Promise<string | null> {
  let p = cache.get(uri);
  if (!p) {
    p = resolvePhoto(uri, host);
    cache.set(uri, p);
    p.then((v) => v === null && cache.delete(uri)); // allow a retry later
  }
  return p;
}

export async function allPhotoData(uris: string[], host: Host | null): Promise<Record<string, string | null>> {
  const entries = await Promise.all(uris.map(async (u) => [u, await photoData(u, host)] as const));
  return Object.fromEntries(entries);
}

/** Read a picked image file, downscale it, and return a data URL (for logos). */
export async function fileToDataUrl(file: File, maxSide: number, type: "image/png" | "image/jpeg" = "image/png"): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url, false);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
