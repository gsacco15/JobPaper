import { readPdfDownload } from "../shared/pdf-download.js";

const status = document.getElementById("status")!;
try {
  const { name, base64 } = readPdfDownload(location.hash);
  // Remove document contents from the address bar/history once they are loaded.
  history.replaceState(null, "", location.pathname);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const save = document.getElementById("save") as HTMLAnchorElement;
  save.href = url;
  save.download = name;
  save.hidden = false;
  status.textContent = name;
  document.getElementById("help")!.hidden = false;
  const preview = document.getElementById("preview") as HTMLIFrameElement;
  preview.src = url;
  preview.hidden = false;
  // Try once after painting the page. Browser policy may require the user to
  // tap Save PDF; leave that link visible and never claim the file was saved.
  requestAnimationFrame(() => save.click());
  // The browser releases blob URLs when this document is unloaded. Keeping it
  // until then also lets Back restore the page from the browser's page cache.
} catch {
  status.textContent = "This download link is missing or invalid. Open a new PDF link from JobPaper.";
}
