import { useCallback, useEffect, useRef, useState } from "react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildChangeOrder, type ChangeOrderInput } from "../shared/build.js";
import { DOC_LABELS, type JobDocument } from "../shared/document.js";
import {
  decodeDocUri,
  docTypeForFileName,
  encodeDocUri,
  fileNameFor,
  forStorage,
  isDocUri,
  serializeDocument,
} from "../shared/files.js";
import { normalizeDocument, parseDocumentText } from "../shared/normalize.js";
import { completeSettings, type BusinessSettings } from "../shared/settings.js";
import { modelSummary, toSmsText } from "../shared/text.js";
import { pdfDownloadUrl } from "../shared/pdf-download.js";
import { recompute } from "../shared/totals.js";
import type { Bridge } from "./bridge.js";
import { DocumentPanel } from "./DocumentPanel.js";
import { contentText, parseFileInput } from "./host.js";
import { pdfBase64 } from "./pdf.js";
import { allPhotoData } from "./photos.js";
import { loadRecent, rememberDoc, type RecentDoc } from "./recent.js";
import { ErrorScreen, Home, InlineCard, Loading, LogoSettings } from "./screens.js";
import { Toast, useToast } from "./ui.js";

/** A host file this document came from, so edits can be written back to it. */
interface FileSource {
  uri: string;
  name: string;
  etag?: string;
  writable: boolean;
}

type Screen =
  | { kind: "loading"; label: string }
  | { kind: "doc"; doc: JobDocument; source?: FileSource; readOnlyNote?: string | null }
  | { kind: "home" }
  | { kind: "logo" }
  | { kind: "error"; message: string };

const SAVE_DELAY_MS = 700;

function loadingLabel(args: Record<string, unknown>): string {
  if (parseFileInput(args)) return "Opening file…";
  if ("estimate_file" in args) return "Writing up the change order…";
  if ("job_name" in args) return "Writing up the job report…";
  if ("job_description" in args) return "Writing up the estimate…";
  return "Loading…";
}

export function App({ bridge, initial }: { bridge: Bridge; initial?: { screen?: Screen; logo?: string; displayMode?: string } }) {
  const host = bridge.host;
  const [screen, setScreen] = useState<Screen>(initial?.screen ?? { kind: "loading", label: "Loading…" });
  const [back, setBack] = useState<Screen[]>([]);
  const [logo, setLogo] = useState(initial?.logo ?? "");
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [displayMode, setDisplayMode] = useState(initial?.displayMode ?? host?.displayMode ?? "fullscreen");
  const [expanded, setExpanded] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [browserPdf, setBrowserPdf] = useState<{ docId: string; url: string; missingPhotos: number } | null>(null);
  const [recent, setRecent] = useState<RecentDoc[]>(() => loadRecent());
  const { toast, show } = useToast();
  const handledResult = useRef<CallToolResult | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const go = (next: Screen, keepHistory = false) => {
    setBrowserPdf(null);
    setBack((b) => (keepHistory ? [...b, screenRef.current] : []));
    setScreen(next);
  };

  // ---- Opening documents --------------------------------------------------

  const openHostFile = useCallback(
    async (file: { name: string; resourceUri: string }, inline?: unknown) => {
      const known = inline ? normalizeDocument(inline) : decodeDocUri(file.resourceUri);
      if (known) {
        go({ kind: "doc", doc: known });
        return;
      }
      if (!host) return;
      setScreen({ kind: "loading", label: `Opening ${file.name}…` });
      try {
        const content = await host.readResource(file.resourceUri, "text");
        const doc = parseDocumentText(contentText(content as { text?: string; blob?: string }) ?? "");
        if (!doc) {
          setScreen({ kind: "error", message: `${file.name} isn’t a JobPaper document this panel can read.` });
          return;
        }
        const meta = (content as { openaiMetadata?: { etag?: string; writable?: boolean } }).openaiMetadata;
        go({
          kind: "doc",
          doc,
          source: { uri: file.resourceUri, name: file.name, etag: meta?.etag, writable: !!meta?.writable },
          readOnlyNote: meta?.writable ? null : "Edits show here and in the PDF, but this copy of the file can’t be saved over.",
        });
        rememberDoc(doc);
      } catch {
        setScreen({ kind: "error", message: `Couldn’t open ${file.name}. Try opening it again from the chat.` });
      }
    },
    [host],
  );

  const finishPendingChangeOrder = useCallback(
    async (pending: { estimate_file: string; input: ChangeOrderInput }, s: BusinessSettings) => {
      setScreen({ kind: "loading", label: "Reading the estimate file…" });
      try {
        let source = decodeDocUri(pending.estimate_file);
        if (!source && host) {
          const content = await host.readResource(pending.estimate_file, "text");
          source = parseDocumentText(contentText(content as { text?: string; blob?: string }) ?? "");
        }
        if (!source || source.doc_type === "job_report") {
          setScreen({ kind: "error", message: "That file isn’t a JobPaper estimate, so the change order couldn’t be made. Open the .est.json file and tap “Make a change order”." });
          return;
        }
        const doc = buildChangeOrder(source, pending.input, { settings: s }, isDocUri(pending.estimate_file) ? pending.estimate_file : undefined);
        go({ kind: "doc", doc });
        rememberDoc(doc);
        void host?.updateModelContext(`JobPaper finished the change order in the panel. ${modelSummary(doc)}`, { document: forStorage(doc) }, {
          uri: encodeDocUri(doc),
          name: fileNameFor(doc),
          text: serializeDocument(forStorage(doc)),
        });
      } catch {
        setScreen({ kind: "error", message: "Couldn’t read the estimate file. Open it from the chat and tap “Make a change order”." });
      }
    },
    [host],
  );

  const handleResult = useCallback(
    (result: CallToolResult) => {
      if (handledResult.current === result) return;
      handledResult.current = result;
      const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
      const meta = (result._meta ?? {}) as Record<string, unknown>;
      if (typeof meta["jobpaper/logo"] === "string") setLogo(meta["jobpaper/logo"] as string);
      const s = meta["jobpaper/settings"] ? completeSettings(meta["jobpaper/settings"] as Partial<BusinessSettings>) : null;
      if (s) setSettings(s);

      if (result.isError) {
        // The model was asked to fix its input and call again; the finished
        // document arrives in a new panel.
        setScreen({ kind: "error", message: "ChatGPT is filling in a few details first — the finished document will show up right after this." });
        return;
      }
      if (sc.document && sc.view !== "file") {
        const doc = normalizeDocument(sc.document);
        if (doc) {
          doc.hints = Array.isArray(meta["jobpaper/hints"]) ? (meta["jobpaper/hints"] as string[]) : [];
          go({ kind: "doc", doc });
          rememberDoc(doc);
          setRecent(loadRecent());
          return;
        }
      }
      if (sc.pending) {
        void finishPendingChangeOrder(sc.pending as { estimate_file: string; input: ChangeOrderInput }, s ?? completeSettings(null));
        return;
      }
      if (sc.view === "file" && sc.file) {
        void openHostFile(sc.file as { name: string; resourceUri: string }, sc.document);
        return;
      }
      if (sc.view === "logo") return go({ kind: "logo" });
      if (sc.view === "home") return go({ kind: "home" });
      setScreen({ kind: "error", message: "Something went wrong building this document. Ask again in the chat." });
    },
    [finishPendingChangeOrder, openHostFile],
  );

  useEffect(() => {
    const apply = () => {
      const st = bridge.state;
      if (st.context.displayMode) setDisplayMode(st.context.displayMode);
      if (st.toolResult) handleResult(st.toolResult);
      else if (st.toolInput && screenRef.current.kind === "loading") {
        const file = parseFileInput(st.toolInput);
        if (file) void openHostFile(file);
        else setScreen({ kind: "loading", label: loadingLabel(st.toolInput) });
      }
    };
    apply();
    return bridge.subscribe(apply);
  }, [bridge, handleResult, openHostFile]);

  // ---- Editing + saving ---------------------------------------------------

  const persist = useCallback(
    async (doc: JobDocument, source?: FileSource) => {
      const stored = forStorage(doc);
      const text = serializeDocument(stored);
      rememberDoc(doc);
      setRecent(loadRecent());
      if (!host) return;
      await host.updateModelContext(
        `The user edited this ${DOC_LABELS[doc.doc_type].toLowerCase()} in the JobPaper panel. Current version — use these numbers, not earlier ones: ${modelSummary(doc)}`,
        { document: stored },
        { uri: encodeDocUri(doc), name: fileNameFor(doc), text },
      );
      if (source?.writable) {
        try {
          const res = await host.writeResource(source.uri, text, source.etag);
          if (res?.outcome === "saved") {
            setScreen((cur) => (cur.kind === "doc" && cur.source?.uri === source.uri ? { ...cur, source: { ...source, etag: res.etag } } : cur));
          } else if (res?.outcome === "conflict") {
            show("This file changed somewhere else. Reopen it to see the latest.");
          } else if (res?.outcome === "too-large") {
            show("This file is too big to save. Remove a few photos and try again.");
          }
        } catch {
          show("Couldn’t save the file. Your edits are still here.");
        }
      }
    },
    [host, show],
  );

  const updateDoc = (next: JobDocument) => {
    setBrowserPdf(null);
    const cur = screenRef.current;
    if (cur.kind !== "doc") return;
    const doc = recompute(next);
    const source = cur.source;
    const updated: Screen = { ...cur, doc };
    screenRef.current = updated;
    setScreen(updated);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(doc, source), SAVE_DELAY_MS);
  };

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ---- Actions ------------------------------------------------------------

  const downloadPdf = async (doc: JobDocument) => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setBrowserPdf(null);
    try {
      const images = { logo: logo || null, photos: await allPhotoData(doc.photos.map((p) => p.uri), host) };
      const withLogo = { ...doc, business: { ...doc.business, logo_data_url: logo } };
      const name = fileNameFor(doc, ".pdf");
      const base64 = await pdfBase64(withLogo, images);
      const missing = Object.values(images.photos).filter((v) => v === null).length;
      const viaHost = host?.connected ? await host.downloadFile(name, "application/pdf", { blob: base64 }) : false;
      if (!viaHost) {
        const current = screenRef.current;
        if (current.kind !== "doc" || current.doc !== doc) {
          show("The document changed while preparing the PDF. Tap Download PDF again.");
          return;
        }
        const url = pdfDownloadUrl(name, base64);
        setBrowserPdf({ docId: doc.doc_id, url, missingPhotos: missing });
        show("Opening your PDF…");
        let opened = false;
        if (host) {
          opened = await host.openLink(url);
        } else {
          const popup = window.open(url, "_blank");
          if (popup) {
            popup.opener = null;
            opened = true;
          }
        }
        if (!opened && screenRef.current.kind === "doc" && screenRef.current.doc === doc) {
          show("Your browser didn’t open. Use Open PDF in browser below, or copy the PDF link.");
        }
        return;
      }
      show(missing ? `PDF sent for download. ${missing} photo${missing === 1 ? "" : "s"} couldn’t load.` : "PDF sent for download");
    } catch (error) {
      console.error(error);
      show(error instanceof Error && error.message.includes("too large") ? error.message : "Couldn’t make the PDF. Try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const copyText = async (doc: JobDocument) => {
    const text = toSmsText(doc);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    show(ok ? "Copied — paste it in a text" : "Couldn’t copy on this device");
  };

  const openOriginal = async (doc: JobDocument) => {
    const uri = doc.references.source_uri;
    if (!uri) return;
    const est = decodeDocUri(uri);
    if (est) return go({ kind: "doc", doc: est }, true);
    if (host) {
      try {
        const content = await host.readResource(uri, "text");
        const parsed = parseDocumentText(contentText(content as { text?: string; blob?: string }) ?? "");
        if (parsed) return go({ kind: "doc", doc: parsed }, true);
      } catch {
        // fall through
      }
    }
    show("The original estimate file isn’t available here.");
  };

  const makeChangeOrder = async (doc: JobDocument, source: FileSource | undefined, description: string) => {
    const uri = source?.uri ?? encodeDocUri(doc);
    const sent = await host?.sendMessage(
      `Make a change order for my estimate "${doc.title}".\nWhat changed: ${description}\nestimate_file: ${uri}`,
    );
    if (sent) {
      show("Drafting the change order in the chat…");
      return;
    }
    // No chat to send to (standalone preview): build it here; lines get added by hand.
    const co = buildChangeOrder(doc, { change_description: description }, { settings: settings ?? completeSettings(null) });
    go({ kind: "doc", doc: co }, true);
  };

  const rememberMarkupTax = async (markup: number, tax: number) => {
    if (!host) return;
    try {
      const res = await host.callTool("settings.update", { set: { default_markup_pct: markup, default_tax_pct: tax } });
      if (!res.isError) show("Saved as your default");
    } catch {
      // Still applied to this document.
    }
  };

  const saveLogo = async (dataUrl: string) => {
    if (!host) {
      setLogo(dataUrl);
      return true;
    }
    try {
      const res = await host.callTool("save_logo", { logo_data_url: dataUrl });
      if (res.isError) return false;
      setLogo(dataUrl);
      return true;
    } catch {
      return false;
    }
  };

  const openPickedFile = async (file: File) => {
    const doc = parseDocumentText(await file.text());
    if (!doc) return show("That file isn’t a JobPaper document.");
    if (docTypeForFileName(file.name) && docTypeForFileName(file.name) !== doc.doc_type) {
      // Name and contents disagree; trust the contents.
    }
    go({ kind: "doc", doc }, true);
    rememberDoc(doc);
  };

  const expand = async () => {
    const ok = host && host.canFullscreen ? await host.requestDisplayMode("fullscreen") : false;
    if (!ok) setExpanded(true);
  };

  // ---- Render -------------------------------------------------------------

  const goBack = back.length
    ? () => {
        const prev = back[back.length - 1]!;
        setBack(back.slice(0, -1));
        setScreen(prev);
      }
    : undefined;

  let body: React.ReactNode;
  switch (screen.kind) {
    case "loading":
      body = <Loading label={screen.label} />;
      break;
    case "error":
      body = <ErrorScreen message={screen.message} onHome={() => go({ kind: "home" })} />;
      break;
    case "home":
      body = (
        <Home
          recent={recent}
          canSend={!host || host.connected}
          onStart={async (prompt) => {
            if (await host?.sendMessage(prompt)) show("Writing it up in the chat…");
            else show("Couldn’t reach the chat. Type it there instead.");
          }}
          onOpenFile={openPickedFile}
          onOpenRecent={(r) => go({ kind: "doc", doc: r.doc }, true)}
          onLogo={() => go({ kind: "logo" }, true)}
        />
      );
      break;
    case "logo":
      body = <LogoSettings logo={logo} onSave={saveLogo} onBack={goBack} />;
      break;
    case "doc": {
      const { doc, source } = screen;
      if (displayMode === "inline" && !expanded) {
        body = <InlineCard doc={doc} logo={logo} onOpen={expand} onPdf={() => downloadPdf(doc)} pdfBusy={pdfBusy} />;
      } else {
        body = (
          <DocumentPanel
            doc={doc}
            logo={logo}
            host={host}
            onChange={updateDoc}
            pdfBusy={pdfBusy}
            readOnlyNote={screen.readOnlyNote}
            actions={{
              onDownloadPdf: () => downloadPdf(doc),
              onCopyText: () => copyText(doc),
              onOpenOriginal: doc.doc_type === "change_order" && doc.references.source_uri ? () => openOriginal(doc) : undefined,
              onMakeChangeOrder: doc.doc_type === "estimate" ? (d) => makeChangeOrder(doc, source, d) : undefined,
              onMarkupTax: doc.doc_type === "estimate" ? rememberMarkupTax : undefined,
              onBack: goBack,
              onDeleteLine: (item, index) =>
                show("Line deleted", "Undo", () => {
                  const cur = screenRef.current;
                  if (cur.kind !== "doc" || cur.doc.line_items.some((l) => l.id === item.id)) return;
                  const items = [...cur.doc.line_items];
                  items.splice(Math.min(index, items.length), 0, item);
                  updateDoc({ ...cur.doc, line_items: items });
                }, 5000),
            }}
          />
        );
      }
      break;
    }
  }

  return (
    <main className="min-h-full">
      {body}
      {browserPdf && screen.kind === "doc" && browserPdf.docId === screen.doc.doc_id && (
        <aside className="border-t border-line bg-bg p-4" aria-label="PDF browser download">
          <p className="mb-2 text-sm">Your PDF will download in your browser. If the download doesn’t start, tap Save PDF there. If nothing opened, use the button below.</p>
          {browserPdf.missingPhotos > 0 && <p className="mb-2 text-sm">{browserPdf.missingPhotos} photo{browserPdf.missingPhotos === 1 ? "" : "s"} couldn’t load in this PDF.</p>}
          {host ? (
            <button className="tap rounded-lg bg-accent px-4 py-3 font-semibold text-[var(--primary-foreground)]" onClick={async () => {
              if (!(await host.openLink(browserPdf.url))) show("Couldn’t open the browser. Copy the PDF link below and paste it into your browser.");
            }}>Open PDF in browser</button>
          ) : (
            <a className="text-accent underline" href={browserPdf.url} target="_blank" rel="noreferrer">Open PDF in browser</a>
          )}
          <details className="mt-3 text-sm">
            <summary>Copy PDF link</summary>
            <textarea aria-label="PDF download link" className="mt-2 w-full" readOnly value={browserPdf.url} onFocus={(event) => event.currentTarget.select()} />
          </details>
        </aside>
      )}
      <Toast message={toast?.message ?? null} action={toast?.action} onAction={toast?.onAction} />
    </main>
  );
}

export type { Screen };
