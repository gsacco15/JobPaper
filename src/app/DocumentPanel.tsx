import { useEffect, useState } from "react";
import { DOC_LABELS, type JobDocument, type LineItem, type Photo } from "../shared/document.js";
import {
  depositPct,
  formatMoney,
  formatQty,
  formatSignedMoney,
  lineTotal,
} from "../shared/totals.js";
import type { Host } from "./host.js";
import { LineItems } from "./LineItems.js";
import { photoData } from "./photos.js";
import { Button, cx, Disclosure, EditableText, NumberInput } from "./ui.js";

export interface PanelActions {
  onDownloadPdf: () => void;
  onCopyText: () => void;
  onOpenOriginal?: () => void;
  onMakeChangeOrder?: (description: string) => void;
  onMarkupTax?: (markupPct: number, taxPct: number) => void;
  onBack?: () => void;
  onDeleteLine?: (item: LineItem, index: number) => void;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function DocumentPanel({
  doc,
  onChange,
  logo,
  host,
  actions,
  pdfBusy,
  readOnlyNote,
}: {
  doc: JobDocument;
  onChange: (doc: JobDocument) => void;
  logo: string;
  host: Host | null;
  actions: PanelActions;
  pdfBusy?: boolean;
  readOnlyNote?: string | null;
}) {
  const set = (patch: Partial<JobDocument>) => onChange({ ...doc, ...patch });
  const deleted = (item: LineItem, index: number) => actions.onDeleteLine?.(item, index);

  return (
    <div className="flex min-h-full flex-col">
      <article className="flex-1 space-y-5 px-4 pt-4 pb-28" aria-label={`${DOC_LABELS[doc.doc_type]}: ${doc.title}`}>
        {actions.onBack && (
          <Button variant="ghost" onClick={actions.onBack} className="-ml-3 -mt-2 text-accent">
            ‹ Back
          </Button>
        )}
        <Header doc={doc} logo={logo} />

        {doc.hints && doc.hints.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-card px-3 py-2 text-[13px] text-muted">
            {doc.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        {readOnlyNote && <p className="rounded-xl bg-card px-3 py-2 text-[13px] text-muted">{readOnlyNote}</p>}

        <section aria-label="Client">
          <div className="label">{doc.doc_type === "job_report" ? "Prepared for" : "Client"}</div>
          <EditableText
            label="Client name"
            value={doc.client.name}
            placeholder="Add client name"
            onChange={(name) => set({ client: { ...doc.client, name } })}
            className="font-medium"
          />
          <EditableText
            label="Job address"
            value={doc.client.address_text}
            placeholder="Add job address"
            onChange={(address_text) => set({ client: { ...doc.client, address_text } })}
            className="text-muted"
          />
        </section>

        <EditableText
          label="Title"
          value={doc.title}
          placeholder="Add a title"
          onChange={(title) => set({ title: title || doc.title })}
          className="text-[19px] leading-tight font-semibold"
          maxLength={160}
        />

        {doc.doc_type === "estimate" && (
          <>
            <LineItems items={doc.line_items} onChange={(line_items) => set({ line_items })} onDelete={deleted} />
            <TotalsBlock doc={doc} onChange={onChange} onMarkupTax={actions.onMarkupTax} />
          </>
        )}

        {doc.doc_type === "change_order" && doc.change && (
          <ChangeOrderBody doc={doc} onChange={onChange} onDelete={deleted} />
        )}

        {doc.doc_type === "job_report" && doc.report && <ReportBody doc={doc} onChange={onChange} host={host} />}

        {doc.doc_type !== "job_report" ? (
          <Disclosure title="Notes & terms">
            <div className="space-y-3">
              <div>
                <div className="label">Notes</div>
                <EditableText multiline label="Notes" value={doc.notes} placeholder="Add notes for the customer" onChange={(notes) => set({ notes })} />
              </div>
              <div>
                <div className="label">Editable sample terms</div>
                <EditableText multiline label="Terms" value={doc.terms} placeholder="Add payment terms" onChange={(terms) => set({ terms })} />
                <p className="mt-1 text-[12px] text-muted">Sample wording to edit for your business — not legal advice.</p>
              </div>
            </div>
          </Disclosure>
        ) : (
          <Disclosure title="Notes">
            <EditableText multiline label="Notes" value={doc.notes} placeholder="Add notes" onChange={(notes) => set({ notes })} />
          </Disclosure>
        )}

        {actions.onMakeChangeOrder && <MakeChangeOrder onSubmit={actions.onMakeChangeOrder} />}
      </article>

      <footer
        className="sticky bottom-0 z-10 flex gap-2 border-t border-line bg-bg px-4 pt-3"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <Button variant="primary" onClick={actions.onDownloadPdf} disabled={pdfBusy} className="flex-1">
          {pdfBusy ? "Making PDF…" : "Download PDF"}
        </Button>
        <Button onClick={actions.onCopyText} className={actions.onOpenOriginal ? "" : "flex-1"}>
          Copy as text
        </Button>
        {actions.onOpenOriginal && (
          <Button onClick={actions.onOpenOriginal} label="Open original estimate">
            Original
          </Button>
        )}
      </footer>
    </div>
  );
}

function Header({ doc, logo }: { doc: JobDocument; logo: string }) {
  const b = doc.business;
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {logo && <img src={logo} alt="" className="h-11 max-w-[88px] shrink-0 object-contain" />}
        <div className="min-w-0">
          <div className={cx("truncate font-semibold", !b.name && "text-muted")}>{b.name || "Your business"}</div>
          {b.phone && <div className="text-[13px] text-muted">{b.phone}</div>}
          {b.email && <div className="truncate text-[13px] text-muted">{b.email}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[13px] font-semibold tracking-wide uppercase">
          {doc.doc_type === "change_order" && doc.change ? `Change Order CO-${doc.change.sequence}` : DOC_LABELS[doc.doc_type]}
        </div>
        <div className="text-[13px] text-muted">{longDate(doc.date)}</div>
        {doc.doc_type === "estimate" && doc.valid_days > 0 && (
          <div className="text-[12px] text-muted">Valid {doc.valid_days} days</div>
        )}
      </div>
    </header>
  );
}

function PctRow({
  label,
  pct,
  amount,
  onCommit,
}: {
  label: string;
  pct: number;
  amount: number;
  onCommit: (pct: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      {editing ? (
        <label className="flex items-center gap-2">
          <span className="text-muted">{label}</span>
          <NumberInput
            autoFocus
            label={`${label} percent`}
            value={pct}
            max={100}
            className="w-24"
            onCommit={(v) => {
              setEditing(false);
              onCommit(v);
            }}
          />
          <span className="text-muted">%</span>
        </label>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="tap -ml-1 rounded-lg px-1 text-left text-muted underline decoration-dotted underline-offset-4">
          {label} ({formatQty(pct)}%)
        </button>
      )}
      {!editing && <span className="tabular text-muted">{formatMoney(amount, true)}</span>}
    </div>
  );
}

function TotalsBlock({
  doc,
  onChange,
  onMarkupTax,
  totalLabel = "Total",
  signed,
}: {
  doc: JobDocument;
  onChange: (doc: JobDocument) => void;
  onMarkupTax?: (m: number, t: number) => void;
  totalLabel?: string;
  signed?: boolean;
}) {
  const t = doc.totals;
  const pct = doc.doc_type === "estimate" ? depositPct(doc.terms) : null;
  const setPct = (markup_pct: number, tax_pct: number) => {
    onChange({ ...doc, totals: { ...t, markup_pct, tax_pct } });
    onMarkupTax?.(markup_pct, tax_pct);
  };
  return (
    <section aria-label="Totals" className="tabular space-y-1 border-t border-line pt-3">
      <div className="flex justify-between text-muted">
        <span>Subtotal</span>
        <span>{signed ? formatSignedMoney(t.subtotal) : formatMoney(t.subtotal, true)}</span>
      </div>
      <PctRow label="Markup" pct={t.markup_pct} amount={t.markup} onCommit={(m) => setPct(m, t.tax_pct)} />
      <PctRow label="Tax" pct={t.tax_pct} amount={t.tax} onCommit={(x) => setPct(t.markup_pct, x)} />
      <div className="flex justify-between pt-1 text-[19px] font-semibold">
        <span>{totalLabel}</span>
        <span>{signed ? formatSignedMoney(t.total) : formatMoney(t.total, true)}</span>
      </div>
      {pct !== null && t.total > 0 && (
        <div className="flex justify-between text-[13px] text-muted">
          <span>Deposit ({pct}%)</span>
          <span>{formatMoney((t.total * pct) / 100, true)}</span>
        </div>
      )}
    </section>
  );
}

function ChangeOrderBody({
  doc,
  onChange,
  onDelete,
}: {
  doc: JobDocument;
  onChange: (doc: JobDocument) => void;
  onDelete: (item: LineItem, index: number) => void;
}) {
  const c = doc.change!;
  const setChange = (patch: Partial<typeof c>) => onChange({ ...doc, change: { ...c, ...patch } });
  const toggleRemoved = (id: string) =>
    setChange({ removed_ids: c.removed_ids.includes(id) ? c.removed_ids.filter((x) => x !== id) : [...c.removed_ids, id] });
  return (
    <>
      <section>
        <div className="label">What changed</div>
        <EditableText
          multiline
          label="What changed"
          value={c.change_description}
          placeholder="Describe the change"
          onChange={(change_description) => setChange({ change_description })}
        />
      </section>

      <section>
        <div className="label">Added</div>
        <LineItems
          items={doc.line_items}
          reservedIds={c.prior_items.map((l) => l.id)}
          onChange={(line_items) => onChange({ ...doc, line_items })}
          onDelete={onDelete}
          emptyText="Nothing added."
          addLabel="+ Add line"
        />
      </section>

      {c.prior_items.length > 0 && (
        <Disclosure title={`Removed (${c.removed_ids.length})`} defaultOpen={c.removed_ids.length > 0}>
          <p className="pb-1 text-[13px] text-muted">Tap a line from the contract to remove it or put it back.</p>
          <ul className="divide-y divide-line">
            {c.prior_items.map((item) => {
              const removed = c.removed_ids.includes(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={removed}
                    onClick={() => toggleRemoved(item.id)}
                    className="tap flex w-full items-center gap-3 py-2 text-left"
                  >
                    <span aria-hidden className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded border", removed ? "border-warn text-warn" : "border-input")}>
                      {removed ? "−" : ""}
                    </span>
                    <span className={cx("min-w-0 flex-1", removed ? "" : "text-muted")}>{item.name}</span>
                    <span className={cx("tabular shrink-0", removed ? "text-warn" : "text-muted")}>
                      {removed ? formatMoney(-lineTotal(item)) : formatMoney(lineTotal(item))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      <TotalsBlock doc={doc} onChange={onChange} totalLabel="Net change" signed />

      <section aria-label="Contract total" className="tabular space-y-1 rounded-xl bg-card p-3">
        <div className="flex justify-between text-muted">
          <span>Original estimate</span>
          <span>{formatMoney(c.original_total, true)}</span>
        </div>
        {c.previous_total !== c.original_total && (
          <div className="flex justify-between text-muted">
            <span>Before this change</span>
            <span>{formatMoney(c.previous_total, true)}</span>
          </div>
        )}
        <div className="flex justify-between text-muted">
          <span>This change</span>
          <span>{formatSignedMoney(c.net_change)}</span>
        </div>
        <div className="flex justify-between pt-1 text-[19px] font-semibold">
          <span>New contract total</span>
          <span>{formatMoney(c.new_total, true)}</span>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-muted">Schedule impact</span>
          <span className="flex items-center gap-1">
            <Button variant="ghost" label="One day less" onClick={() => setChange({ schedule_impact_days: c.schedule_impact_days - 1 })}>
              −
            </Button>
            <span className="min-w-[64px] text-center">
              {c.schedule_impact_days > 0 ? "+" : ""}
              {c.schedule_impact_days} day{Math.abs(c.schedule_impact_days) === 1 ? "" : "s"}
            </span>
            <Button variant="ghost" label="One day more" onClick={() => setChange({ schedule_impact_days: c.schedule_impact_days + 1 })}>
              +
            </Button>
          </span>
        </div>
      </section>
    </>
  );
}

function ReportBody({ doc, onChange, host }: { doc: JobDocument; onChange: (doc: JobDocument) => void; host: Host | null }) {
  const r = doc.report!;
  const setReport = (patch: Partial<typeof r>) => onChange({ ...doc, report: { ...r, ...patch } });
  const setPhoto = (index: number, patch: Partial<Photo>) =>
    onChange({ ...doc, photos: doc.photos.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  return (
    <>
      <section className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="label">Crew</span>
          <NumberInput label="Crew size" decimals={0} value={r.crew_count ?? 0} onCommit={(v) => setReport({ crew_count: v || null })} />
        </label>
        <label className="block">
          <span className="label">Hours</span>
          <NumberInput label="Hours" decimals={1} value={r.hours ?? 0} onCommit={(v) => setReport({ hours: v || null })} />
        </label>
        <div>
          <span className="label">Period</span>
          <button
            type="button"
            onClick={() => setReport({ period: r.period === "daily" ? "weekly" : "daily" })}
            className="field tap text-left"
          >
            {r.period === "weekly" ? "Weekly" : "Daily"}
          </button>
        </div>
      </section>
      <section>
        <div className="label">Weather</div>
        <EditableText label="Weather" value={r.weather_text} placeholder="Add weather (optional)" onChange={(weather_text) => setReport({ weather_text })} />
      </section>
      <section>
        <div className="label">Work completed</div>
        <EditableText multiline label="Work completed" value={r.work_done} placeholder="What got done" onChange={(work_done) => setReport({ work_done })} />
      </section>

      {doc.photos.length > 0 && (
        <section aria-label="Photos">
          <div className="label mb-2">Photos</div>
          <div className="grid grid-cols-2 gap-3">
            {doc.photos.map((p, i) => (
              <figure key={`${p.uri}-${i}`} className="min-w-0">
                {p.area && (i === 0 || doc.photos[i - 1]!.area.toLowerCase() !== p.area.toLowerCase()) ? (
                  <div className="mb-1 truncate text-[13px] font-medium">{p.area}</div>
                ) : (
                  p.area && <div className="mb-1 h-[19.5px]" aria-hidden />
                )}
                <PhotoImage uri={p.uri} host={host} alt={p.caption || `Photo ${i + 1}`} />
                <figcaption>
                  <EditableText
                    label={`Caption for photo ${i + 1}`}
                    value={p.caption}
                    placeholder="Add caption"
                    onChange={(caption) => setPhoto(i, { caption })}
                    className="text-[13px]"
                    maxLength={300}
                  />
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="label">Issues</div>
        <EditableText multiline label="Issues" value={r.issues} placeholder="None" onChange={(issues) => setReport({ issues })} />
      </section>
      <section>
        <div className="label">Next steps</div>
        <EditableText multiline label="Next steps" value={r.next_steps} placeholder="Add next steps" onChange={(next_steps) => setReport({ next_steps })} />
      </section>
    </>
  );
}

function PhotoImage({ uri, host, alt }: { uri: string; host: Host | null; alt: string }) {
  const direct = /^(https?:|data:image\/)/i.test(uri);
  const [src, setSrc] = useState<string | null>(direct ? uri : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (direct && attempt === 0) return;
    let live = true;
    setFailed(false);
    photoData(uri, host).then((data) => {
      if (!live) return;
      if (data) setSrc(data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [uri, host, attempt, direct]);

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => setAttempt((a) => a + 1)}
        className="tap flex aspect-[4/3] w-full flex-col items-center justify-center rounded-lg bg-card text-[13px] text-muted"
      >
        <span>Photo didn’t load</span>
        <span className="underline">Tap to retry</span>
      </button>
    );
  }
  if (!src) return <div className="aspect-[4/3] w-full animate-pulse rounded-lg bg-card" aria-label="Loading photo" />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (attempt === 0) setAttempt(1);
        else setFailed(true);
      }}
      className="aspect-[4/3] w-full rounded-lg bg-card object-cover"
    />
  );
}

function MakeChangeOrder({ onSubmit }: { onSubmit: (description: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full">
        Make a change order
      </Button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-xl bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <label className="label" htmlFor="co-text">
        What changed?
      </label>
      <textarea
        id="co-text"
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. They want to add a heated floor and skip the new vanity"
        className="field"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!text.trim()}>
          Draft change order
        </Button>
      </div>
    </form>
  );
}
