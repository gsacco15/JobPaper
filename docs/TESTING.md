# Manual test plan (real devices)

Automated coverage is in `npm test`. This is what a person checks in ChatGPT (developer mode) on a phone and on desktop before submitting and after every release.

Prep: `npm run dev` plus a tunnel, connector added, settings cleared.

## 1. First run with settings unset
- [ ] "write up an estimate for a 6 ft cedar fence, 120 linear feet, for the Lees"
- [ ] The panel opens filled in (no empty state). The hint lines mention business name/phone and markup/tax at 0%.
- [ ] The model's reply is one line: total + "Tap any line to edit, Download PDF when ready."

## 2. Settings
- [ ] Plugin settings show Business name, Phone, Email, Logo button, Default markup %, Sales tax %, Payment terms.
- [ ] Fill them in, then ask for a new estimate: the header shows the business, totals include markup and tax, hints are gone.
- [ ] Logo: pick a large photo; it saves (downsized) and shows on the next document and in the PDF.

## 3. Estimate panel (phone, light and dark)
- [ ] Inline card shows title, 3 lines, total, Open. Open → fullscreen.
- [ ] Tap a line → edit qty (numeric keyboard), unit, price → Done; totals update.
- [ ] Swipe left → Delete; long-press → Delete? → Undo restores it.
- [ ] Drag a handle to reorder.
- [ ] + Add line → type → Done. Leaving the name empty removes it.
- [ ] Tap Tax → set 8.25 → "Saved as your default". The next estimate uses 8.25.
- [ ] Notes & terms expand; terms are labeled "Editable sample terms".
- [ ] Ask "what's the total now?" → the model answers with the edited total.

## 4. PDF and text
- [ ] Download PDF → file saves (iOS Files / Android Downloads / desktop). It opens with logo, table, totals, deposit, approval line, page numbers.
- [ ] Copy as text → paste into Messages: title, lines, total, deposit, phone.
- [ ] Input → sendable PDF in ≤3 taps: Open → Download PDF (or PDF on the inline card).

## 5. Change orders
- [ ] "The customer added a heated floor. Change order." → CO-1 panel. Original total matches the estimate; net change and new contract total are correct.
- [ ] Removed section: tap an estimate line to remove it; totals update.
- [ ] Schedule impact ± works.
- [ ] Original → shows the estimate; Back returns to the CO.
- [ ] Second change: "they also want a niche" → CO-2 starts from CO-1's new total.

## 6. Files (desktop)
- [ ] The estimate shows as `<title>.est.json` in the chat. Close the chat, reopen it, click the file → JobPaper viewer opens.
- [ ] Edit a line → file saves (reopen shows the edit).
- [ ] Make a change order → type what changed → the model drafts CO-1 referencing the file.
- [ ] Attach a non-JobPaper `.json` named `x.est.json` → friendly "isn't a JobPaper document" message.

## 7. Job report
- [ ] Attach 3–4 photos: "end of day report for the Henderson job — 3 guys, 8 hours, finished demo, grout backordered".
- [ ] Photos 2 across, grouped by area, captions editable. Issues and next steps come last.
- [ ] A photo that fails to load shows "Photo didn't load — Tap to retry"; the PDF still generates.
- [ ] Download PDF includes the photos.

## 8. Error states
- [ ] "write up an estimate" (no description) → exactly one question: what's the job?
- [ ] "make a change order" with no estimate in the chat → one question: which estimate?
- [ ] Airplane mode mid-edit → the panel stays usable; PDF still works offline.

## 9. Sidebar and thread tab
- [ ] Sidebar → JobPaper opens fullscreen home: tabs, Write it up sends to the chat; Open a saved file works; recent docs list (if storage is allowed).
- [ ] Thread tab "Job Papers" opens the same home.
