import { describe, expect, it } from "vitest";
import { pdfDownloadUrl, readPdfDownload } from "../src/shared/pdf-download.js";

describe("browser PDF transfer", () => {
  it("keeps the filename and PDF bytes in the fragment, out of the request URL", () => {
    const name = "Fence estimate — José & Mike.pdf";
    const base64 = btoa("%PDF-1.7\n\0\xff\n%%EOF");
    const url = new URL(pdfDownloadUrl(name, base64));
    expect(url.origin + url.pathname + url.search).toBe("https://jobpaperapp.com/download");
    expect(readPdfDownload(url.hash)).toEqual({ name, base64 });
  });

  it("rejects missing, corrupt and non-PDF payloads", () => {
    for (const fragment of ["", "#pdf=broken", new URL(pdfDownloadUrl("a.pdf", btoa("not a PDF"))).hash]) {
      expect(() => readPdfDownload(fragment)).toThrow();
    }
  });

  it("rejects files too large for the browser link without dropping content", () => {
    expect(() => pdfDownloadUrl("large.pdf", "JVBERi0" + "A".repeat(1_500_000))).toThrow("too large");
  });
});
