import { useRef, useState } from "react";
import { DOC_LABELS, type JobDocument } from "../shared/document.js";
import { formatMoney, formatSignedMoney, lineTotal } from "../shared/totals.js";
import { fileToDataUrl } from "./photos.js";
import type { RecentDoc } from "./recent.js";
import { Button, cx, Spinner } from "./ui.js";

/** Inline card: title, up to 3 lines, total, one Open button. */
export function InlineCard({ doc, logo, onOpen, onPdf, pdfBusy }: { doc: JobDocument; logo: string; onOpen: () => void; onPdf: () => void; pdfBusy?: boolean }) {
  const lines =
    doc.doc_type === "job_report"
      ? [doc.report?.work_done ?? ""].filter(Boolean)
      : doc.line_items.slice(0, 3).map((l) => `${l.name} — ${formatMoney(lineTotal(l))}`);
  const more = doc.doc_type === "job_report" ? 0 : Math.max(0, doc.line_items.length - 3);
  const total =
    doc.doc_type === "change_order" && doc.change
      ? { label: "New contract total", value: formatMoney(doc.change.new_total, true), sub: `Change ${formatSignedMoney(doc.change.net_change)}` }
      : doc.doc_type === "estimate"
        ? { label: "Total", value: formatMoney(doc.totals.total, true), sub: "" }
        : { label: "Photos", value: String(doc.photos.length), sub: "" };
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">
            {doc.doc_type === "change_order" && doc.change ? `Change order CO-${doc.change.sequence}` : DOC_LABELS[doc.doc_type]}
            {doc.business.name ? ` · ${doc.business.name}` : ""}
          </div>
          <h2 className="mt-0.5 truncate text-[17px] font-semibold">{doc.title}</h2>
        </div>
        {logo && <img src={logo} alt="" className="h-9 max-w-[72px] shrink-0 object-contain" />}
      </div>
      <ul className="mt-2 space-y-0.5 text-[14px] text-muted">
        {lines.map((l, i) => (
          <li key={i} className={cx(doc.doc_type === "job_report" ? "line-clamp-3" : "truncate")}>
            {l}
          </li>
        ))}
        {more > 0 && <li>+{more} more</li>}
      </ul>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="tabular">
          <div className="text-[13px] text-muted">{total.label}</div>
          <div className="text-[22px] leading-tight font-semibold">{total.value}</div>
          {total.sub && <div className="text-[13px] text-muted">{total.sub}</div>}
        </div>
        <div className="flex gap-2">
          <Button onClick={onPdf} disabled={pdfBusy} label="Download PDF">
            {pdfBusy ? "…" : "PDF"}
          </Button>
          <Button variant="primary" onClick={onOpen}>
            Open
          </Button>
        </div>
      </div>
    </div>
  );
}

const STARTERS = [
  { key: "estimate", label: "Estimate", prompt: "Write up an estimate for ", placeholder: "Bathroom remodel for the Hendersons — demo tile and vanity, new tile floor (about 50 sq ft), new vanity and toilet" },
  { key: "change_order", label: "Change order", prompt: "Change order: ", placeholder: "The customer added a heated floor to the Henderson bathroom" },
  { key: "job_report", label: "Job report", prompt: "Daily report for the job: ", placeholder: "Henderson bath — set tile in the shower, 2 guys, 8 hours, grout color is backordered" },
] as const;

export function Home({
  recent,
  onStart,
  onOpenFile,
  onOpenRecent,
  onLogo,
  canSend,
}: {
  recent: RecentDoc[];
  onStart: (prompt: string) => void;
  onOpenFile: (file: File) => void;
  onOpenRecent: (r: RecentDoc) => void;
  onLogo: () => void;
  canSend: boolean;
}) {
  const [kind, setKind] = useState<(typeof STARTERS)[number]["key"]>("estimate");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const starter = STARTERS.find((s) => s.key === kind)!;
  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-[22px] font-semibold">JobPaper</h1>
        <p className="text-muted">Notes and photos in, a PDF you can send out.</p>
      </div>

      {canSend && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onStart(starter.prompt + text.trim());
          }}
        >
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-full bg-card p-1">
            {STARTERS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={kind === s.key}
                onClick={() => setKind(s.key)}
                className={cx("tap rounded-full px-2 text-[14px]", kind === s.key ? "bg-bg font-medium shadow-sm" : "text-muted")}
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            aria-label={`Describe the ${starter.label.toLowerCase()}`}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={starter.placeholder}
            className="field"
          />
          <Button variant="primary" type="submit" disabled={!text.trim()} className="w-full">
            Write it up
          </Button>
        </form>
      )}

      {recent.length > 0 && (
        <section>
          <div className="label mb-1">Recent</div>
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.doc_id}>
                <button type="button" onClick={() => onOpenRecent(r)} className="tap flex w-full items-center justify-between gap-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className="block truncate">{r.title}</span>
                    <span className="block text-[13px] text-muted">
                      {DOC_LABELS[r.doc_type]} · {r.date}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-muted">{r.total_text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpenFile(f);
            e.target.value = "";
          }}
        />
        <Button onClick={() => fileRef.current?.click()} className="w-full">
          Open a saved .est.json, .co.json, or .rpt.json
        </Button>
        <Button variant="ghost" onClick={onLogo} className="w-full text-accent">
          Add or change your logo
        </Button>
        <p className="text-center text-[13px] text-muted">
          Business name, phone, markup, tax, and terms live in JobPaper’s plugin settings.
        </p>
      </section>
    </div>
  );
}

export function LogoSettings({
  logo,
  onSave,
  onBack,
}: {
  logo: string;
  onSave: (dataUrl: string) => Promise<boolean>;
  onBack?: () => void;
}) {
  const [preview, setPreview] = useState(logo);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (dataUrl: string) => {
    setStatus("saving");
    const ok = await onSave(dataUrl);
    setStatus(ok ? "saved" : "error");
    if (ok) setPreview(dataUrl);
  };

  return (
    <div className="space-y-4 p-4">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="-ml-3 text-accent">
          ‹ Back
        </Button>
      )}
      <h1 className="text-[20px] font-semibold">Logo</h1>
      <p className="text-muted">Printed at the top of every estimate, change order, and report.</p>
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-input bg-card">
        {preview ? <img src={preview} alt="Your logo" className="max-h-24 max-w-[80%] object-contain" /> : <span className="text-muted">No logo yet</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setError("");
          try {
            let data = await fileToDataUrl(f, 480, "image/png");
            if (data.length > 190_000) data = await fileToDataUrl(f, 360, "image/jpeg");
            await save(data);
          } catch {
            setError("That image couldn't be read. Try a PNG or JPG.");
            setStatus("error");
          }
        }}
      />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => fileRef.current?.click()} className="flex-1" disabled={status === "saving"}>
          {preview ? "Change logo" : "Choose image"}
        </Button>
        {preview && (
          <Button variant="danger" onClick={() => save("")} disabled={status === "saving"}>
            Remove
          </Button>
        )}
      </div>
      {status === "saving" && <Spinner label="Saving…" />}
      {status === "saved" && <p className="text-muted">Saved. New documents will use it.</p>}
      {status === "error" && <p className="text-warn">{error || "Couldn't save the logo. Try again."}</p>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-4 p-4">
      <Spinner label={label} />
      <div className="space-y-2" aria-hidden>
        <div className="h-5 w-2/3 animate-pulse rounded bg-card" />
        <div className="h-12 animate-pulse rounded bg-card" />
        <div className="h-12 animate-pulse rounded bg-card" />
        <div className="h-12 animate-pulse rounded bg-card" />
      </div>
    </div>
  );
}

export function ErrorScreen({ message, onHome }: { message: string; onHome?: () => void }) {
  return (
    <div className="space-y-3 p-4">
      <p>{message}</p>
      {onHome && <Button onClick={onHome}>Start over</Button>}
    </div>
  );
}
