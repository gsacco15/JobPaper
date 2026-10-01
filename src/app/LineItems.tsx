import { useRef, useState } from "react";
import { UNITS, type LineItem } from "../shared/document.js";
import { nextLineId } from "../shared/ids.js";
import { formatMoney, formatQty, lineTotal } from "../shared/totals.js";
import { Button, cx, NumberInput } from "./ui.js";

const LONG_PRESS_MS = 550;
const SWIPE_DELETE_PX = 72;

export function LineItems({
  items,
  onChange,
  onDelete,
  sign = 1,
  addLabel = "+ Add line",
  emptyText,
  reservedIds = [],
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  /** Called after a delete so the parent can offer Undo. */
  onDelete?: (item: LineItem, index: number) => void;
  sign?: 1 | -1;
  addLabel?: string;
  emptyText?: string;
  /** Ids already used elsewhere (a change order's prior contract lines). */
  reservedIds?: string[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const update = (id: string, patch: Partial<LineItem>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const remove = (id: string) => {
    const index = items.findIndex((it) => it.id === id);
    const item = items[index];
    if (!item) return;
    setEditing(null);
    onChange(items.filter((it) => it.id !== id));
    onDelete?.(item, index);
  };

  const add = () => {
    const id = nextLineId([...reservedIds, ...items.map((i) => i.id)]);
    onChange([...items, { id, name: "", qty: 1, unit: "job", unit_price: 0 }]);
    setEditing(id);
  };

  // Drag-to-reorder from the handle, using pointer events (touch + mouse).
  const rowIndexAt = (clientY: number): number => {
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length - 1;
  };
  const startDrag = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, over: items.findIndex((i) => i.id === id) });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, over: rowIndexAt(e.clientY) });
  };
  const endDrag = () => {
    if (!drag) return;
    const from = items.findIndex((i) => i.id === drag.id);
    if (from >= 0 && drag.over !== from) {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(drag.over, 0, moved!);
      onChange(next);
    }
    setDrag(null);
  };

  return (
    <div>
      {items.length === 0 && emptyText && <p className="py-2 text-muted">{emptyText}</p>}
      <ul ref={listRef} className="divide-y divide-line">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={cx(
              drag?.id === item.id && "opacity-60",
              drag && drag.id !== item.id && drag.over === index && "border-t-2 border-t-accent",
            )}
          >
            {editing === item.id ? (
              <EditRow
                item={item}
                onPatch={(patch) => update(item.id, patch)}
                onDone={(finalName) => {
                  if (!finalName) remove(item.id);
                  else setEditing(null);
                }}
                onDelete={() => remove(item.id)}
              />
            ) : (
              <Row
                item={item}
                sign={sign}
                canReorder={items.length > 1}
                onTap={() => setEditing(item.id)}
                onDelete={() => remove(item.id)}
                onHandleDown={(e) => startDrag(item.id, e)}
                onHandleMove={moveDrag}
                onHandleUp={endDrag}
              />
            )}
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={add} className="-ml-2 mt-1 text-accent">
        {addLabel}
      </Button>
    </div>
  );
}

function Row({
  item,
  sign,
  canReorder,
  onTap,
  onDelete,
  onHandleDown,
  onHandleMove,
  onHandleUp,
}: {
  item: LineItem;
  sign: 1 | -1;
  canReorder: boolean;
  onTap: () => void;
  onDelete: () => void;
  onHandleDown: (e: React.PointerEvent) => void;
  onHandleMove: (e: React.PointerEvent) => void;
  onHandleUp: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-handle],[data-delete]")) return;
    const g = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false } as NonNullable<typeof gesture.current>;
    g.timer = setTimeout(() => {
      if (!g.moved) {
        setConfirm(true);
        gesture.current = null;
      }
    }, LONG_PRESS_MS);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      g.moved = true;
      clearTimeout(g.timer);
    }
    if (Math.abs(dx) > Math.abs(dy) && dx < 0) setOffset(Math.max(dx, -SWIPE_DELETE_PX - 24));
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (offset <= -SWIPE_DELETE_PX) {
      setOffset(-SWIPE_DELETE_PX);
      return;
    }
    setOffset(0);
    if (!g.moved) onTap();
  };

  if (confirm) {
    return (
      <div className="flex min-h-[56px] items-center justify-between gap-2 py-1">
        <span className="truncate">Delete “{item.name}”?</span>
        <span className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <button
        type="button"
        data-delete
        aria-label={`Delete ${item.name}`}
        tabIndex={offset < 0 ? 0 : -1}
        aria-hidden={offset < 0 ? undefined : true}
        onClick={onDelete}
        className="tap absolute inset-y-0 right-0 w-[72px] text-warn font-medium"
      >
        Delete
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.name}, ${formatQty(item.qty)} ${item.unit} at ${formatMoney(item.unit_price)}. Tap to edit.`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap();
          }
          if (e.key === "Delete" || e.key === "Backspace") setConfirm(true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          clearTimeout(gesture.current?.timer);
          gesture.current = null;
          setOffset(0);
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        className="relative flex min-h-[56px] cursor-[var(--cursor-interaction,pointer)] items-center gap-2 bg-bg py-2 transition-transform duration-150 select-none"
      >
        {canReorder && (
          <span
            data-handle
            aria-hidden
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            style={{ touchAction: "none" }}
            className="-ml-2 flex h-11 w-7 shrink-0 cursor-grab items-center justify-center text-muted"
          >
            ⋮⋮
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block leading-snug">{item.name || <span className="text-muted">Untitled line</span>}</span>
          <span className="tabular block text-[13px] text-muted">
            {formatQty(item.qty)} {item.unit} × {formatMoney(item.unit_price)}
          </span>
        </span>
        <span className="tabular shrink-0 text-right font-medium">{formatMoney(sign * lineTotal(item))}</span>
      </div>
    </div>
  );
}

function EditRow({
  item,
  onPatch,
  onDone,
  onDelete,
}: {
  item: LineItem;
  onPatch: (patch: Partial<LineItem>) => void;
  onDone: (finalName: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const units: string[] = UNITS.includes(item.unit as (typeof UNITS)[number]) ? [...UNITS] : [...UNITS, item.unit];
  return (
    <div className="space-y-2 rounded-xl bg-card p-3 my-2">
      <textarea
        aria-label="Line description"
        autoFocus={!item.name}
        rows={2}
        value={name}
        placeholder="What's the work? e.g. Patch and paint ceiling"
        maxLength={300}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== item.name && onPatch({ name: name.trim() })}
        className="field resize-none"
      />
      <div className="grid grid-cols-[1fr_1.2fr_1.4fr] gap-2">
        <label className="block">
          <span className="label">Qty</span>
          <NumberInput label="Quantity" value={item.qty} onCommit={(qty) => onPatch({ qty })} />
        </label>
        <label className="block">
          <span className="label">Unit</span>
          <select
            aria-label="Unit"
            value={item.unit}
            onChange={(e) => onPatch({ unit: e.target.value })}
            className="field"
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Price</span>
          <NumberInput label="Unit price in dollars" value={item.unit_price} onCommit={(unit_price) => onPatch({ unit_price })} />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <Button variant="danger" onClick={onDelete} className="-ml-2">
          Delete
        </Button>
        <span className="tabular text-muted">{formatMoney(lineTotal(item))}</span>
        <Button
          variant="primary"
          onClick={() => {
            const finalName = name.trim();
            if (finalName && finalName !== item.name) onPatch({ name: finalName });
            onDone(finalName);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
