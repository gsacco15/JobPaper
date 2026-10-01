import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import { DOC_EXTENSIONS, type DocType, type JobDocument } from "./document.js";
import { normalizeDocument } from "./normalize.js";

// ChatGPT's own files are the database. A document travels as a small JSON
// file; when it can't be a real host file it travels inside a self-contained
// jobpaper:// URI, so the stateless server can read it back with no storage.

export const DOC_URI_PREFIX = "jobpaper://doc/";

/** File extensions the file-viewer entrypoint registers for. */
export const FILE_EXTENSIONS = Object.values(DOC_EXTENSIONS);

export function docTypeForFileName(name: string): DocType | null {
  const lower = name.toLowerCase();
  for (const [type, ext] of Object.entries(DOC_EXTENSIONS) as [DocType, string][]) {
    if (lower.endsWith(ext)) return type;
  }
  return null;
}

/** "Bathroom remodel — Henderson" -> "Bathroom remodel - Henderson.est.json" */
export function fileNameFor(doc: Pick<JobDocument, "title" | "doc_type">, ext?: string): string {
  const safe =
    doc.title
      .replace(/[—–·•]/g, "-")
      .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "JobPaper";
  return safe + (ext ?? DOC_EXTENSIONS[doc.doc_type]);
}

export function serializeDocument(doc: JobDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** What gets saved: the logo stays in settings, hints are UI-only. */
export function forStorage(doc: JobDocument): JobDocument {
  const { hints: _hints, ...rest } = doc;
  return { ...rest, business: { ...doc.business, logo_data_url: "" } };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * jobpaper://doc/<file name>?z=<base64url(zlib(JSON))> (zlib carries a checksum)
 * Compressed so the URI stays short enough for the model to pass back intact.
 * A corrupted URI fails to inflate and is rejected rather than misread.
 */
export function encodeDocUri(doc: JobDocument): string {
  const payload = bytesToBase64Url(zlibSync(strToU8(JSON.stringify(forStorage(doc))), { level: 9 }));
  return `${DOC_URI_PREFIX}${encodeURIComponent(fileNameFor(doc))}?z=${payload}`;
}

export function isDocUri(uri: string): boolean {
  return typeof uri === "string" && uri.startsWith(DOC_URI_PREFIX);
}

export function decodeDocUri(uri: string): JobDocument | null {
  if (!isDocUri(uri)) return null;
  const match = /[?&]([zd])=([^&#]*)/.exec(uri);
  if (!match) return null;
  try {
    const bytes = base64UrlToBytes(decodeURIComponent(match[2]!));
    // z = zlib JSON; d = plain JSON (early builds).
    const text = match[1] === "z" ? strFromU8(unzlibSync(bytes)) : strFromU8(bytes);
    return normalizeDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Accepts whatever a model or user might hand over as "the estimate file":
 * a jobpaper:// URI, or the file's JSON text pasted inline.
 */
export function resolveInlineDocument(ref: string): JobDocument | null {
  const trimmed = ref.trim();
  if (isDocUri(trimmed)) return decodeDocUri(trimmed);
  if (trimmed.startsWith("{")) {
    try {
      return normalizeDocument(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return null;
}
