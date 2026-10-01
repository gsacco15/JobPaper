import { useEffect, useRef, useState, type ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  className,
  label,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  label?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "tap inline-flex items-center justify-center gap-2 rounded-full px-4 text-[15px] font-medium transition-opacity select-none",
        "disabled:opacity-40 active:opacity-70",
        variant === "primary" && "bg-fg text-bg",
        variant === "secondary" && "border border-input bg-bg text-fg",
        variant === "ghost" && "text-fg",
        variant === "danger" && "text-warn",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Text that turns into an input when tapped. Commits on blur or Enter,
 * reverts on Escape. Multiline uses a textarea (Enter adds a line).
 */
export function EditableText({
  value,
  onChange,
  placeholder,
  multiline,
  className,
  inputClassName,
  label,
  maxLength = 2000,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  label: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select?.();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.replace(/[ \t]+$/gm, "").trim();
    if (next !== value) onChange(next);
  };

  if (editing) {
    const common = {
      ref,
      value: draft,
      maxLength,
      "aria-label": label,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
        if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      },
      className: cx("field", inputClassName),
    };
    return multiline ? <textarea rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))} {...common} /> : <input {...common} />;
  }

  return (
    <button
      type="button"
      aria-label={`${label}: ${value || "empty"}. Tap to edit.`}
      onClick={() => setEditing(true)}
      className={cx(
        "tap -mx-1.5 flex w-[calc(100%+12px)] items-start rounded-lg px-1.5 py-2.5 text-left whitespace-pre-wrap",
        "active:bg-subtle",
        !value && "text-muted",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{value || placeholder}</span>
    </button>
  );
}

/** Numeric field with the numeric keyboard on phones. Commits on blur/Enter. */
export function NumberInput({
  value,
  onCommit,
  label,
  className,
  decimals = 2,
  min = 0,
  max = 1_000_000_000,
  autoFocus,
  allowNegative,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  className?: string;
  decimals?: number;
  min?: number;
  max?: number;
  autoFocus?: boolean;
  allowNegative?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const cleaned = draft.replace(/[$,%\s]/g, "");
    let n = Number(cleaned);
    if (!Number.isFinite(n) || cleaned === "") n = value;
    n = Math.min(max, Math.max(allowNegative ? -max : min, n));
    const f = 10 ** decimals;
    n = Math.round(n * f) / f;
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="text"
      inputMode={allowNegative ? "text" : "decimal"}
      enterKeyHint="done"
      aria-label={label}
      autoFocus={autoFocus}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className={cx("field tabular text-right", className)}
    />
  );
}

export function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="tap flex w-full items-center justify-between py-2 text-left"
      >
        <span className="label">{title}</span>
        <span aria-hidden className={cx("text-muted transition-transform", open && "rotate-180")}>
          ⌄
        </span>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

export function Toast({ message, action, onAction }: { message: string | null; action?: string; onAction?: () => void }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-fg px-4 py-2 text-[14px] text-bg shadow-lg">
        <span>{message}</span>
        {action && onAction && (
          <button type="button" onClick={onAction} className="tap -my-2 font-semibold underline">
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; action?: string; onAction?: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (message: string, action?: string, onAction?: () => void, ms = 3500) => {
    clearTimeout(timer.current);
    setToast({ message, action, onAction });
    timer.current = setTimeout(() => setToast(null), ms);
  };
  return { toast, show, clear: () => setToast(null) };
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-muted" role="status">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>{label}</span>
    </div>
  );
}
