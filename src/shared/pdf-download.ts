// The fragment is read only in the browser: it is never sent to the web server.
// Carry the finished PDF so the browser exports exactly what the panel rendered.
const MAX_LINK_LENGTH = 1_500_000;
export interface PdfDownload { name: string; base64: string }

export function pdfDownloadUrl(name: string, base64: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ name, base64 }));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = `https://jobpaperapp.com/download#pdf=${payload}`;
  if (url.length > MAX_LINK_LENGTH) throw new Error("This PDF is too large for a browser download link. Reduce the photo sizes and try again.");
  return url;
}

export function readPdfDownload(fragment: string): PdfDownload {
  if (fragment.length > MAX_LINK_LENGTH || !/^#pdf=[A-Za-z0-9_-]+$/.test(fragment)) throw new Error("This download link is missing or invalid. Open a new PDF link from JobPaper.");
  const encoded = fragment.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
  const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  if (typeof payload?.name !== "string" || !payload.name.endsWith(".pdf") || typeof payload.base64 !== "string" || !payload.base64.startsWith("JVBERi0")) throw new Error("This download link does not contain a PDF. Open a new PDF link from JobPaper.");
  // Decode once here to reject truncated or malformed binary before showing success.
  atob(payload.base64);
  return payload;
}
