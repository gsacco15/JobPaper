---
name: jobpaper
description: Turn a contractor's notes and photos into an estimate, change order, or daily/weekly job report with an editable panel and a PDF to send. Use when the user says "write up an estimate for…", "put together a quote for…", "bid for a…", "price out a…", "change order for…", "the customer added…", "they want to add… to the job", "daily report for the … job", "job report from these photos", "end of day report", or "weekly update for the homeowner" — for remodel, bathroom, kitchen, roof, fence, deck, drywall, paint, HVAC, plumbing, electrical, landscaping, concrete, flooring, or tile work.
---

# JobPaper

JobPaper makes three documents: an **estimate**, a **change order**, and a **job report**. Each one opens as a panel that looks like the PDF the customer gets. The contractor taps any line to fix it, then taps **Download PDF** or **Copy as text**.

## When to use

Use JobPaper when the user wants a customer-facing paper for a trade job:

- Estimates: "write up an estimate for…", "put together a quote for…", "bid for a…", "price out a…"
- Change orders: "change order for…", "the customer added…", "they want to add… to the job"
- Job reports: "daily report for the … job", "job report from these photos", "end of day report", "weekly update for the homeowner"

Trades: remodel, bathroom, kitchen, roof, fence, deck, drywall, paint, HVAC, plumbing, electrical, landscaping, concrete, flooring, tile.

Don't use it for invoices, scheduling, client lists, or general pricing questions.

## Estimates — `create_estimate`

Draft the line items yourself **before** calling the tool:

- 3–10 lines, in plain English, like a text to the customer: "Demo existing tile and vanity", not "DEMO-TILE-VNTY".
- Split labor and materials only when the user mentions both.
- Units: `job`, `hr`, `sq ft`, `ln ft`, or `each`. Use `job` for lump sums.
- Round every price to the dollar. Use the user's numbers when they give them; otherwise use typical prices for their trade and say nothing about it — they will tap to fix.
- Put real assumptions or exclusions in `notes` ("Fixtures supplied by homeowner"). Skip filler.
- Pass `client_name` and `job_address_text` only if the user typed them. Never look up or guess a location.

Never add up totals, markup, or tax yourself. The server does the math from the user's settings and returns the totals.

## Change orders — `create_change_order`

`estimate_file` is the resource URI of the saved estimate file (`.est.json`) — the link returned when the estimate was made, or the file the user opened or attached. If this job already has a change order, pass the **latest** `.co.json` instead so the numbering continues (CO-1, CO-2…) from the current contract total.

- `added_items`: new lines, drafted the same way as estimate lines.
- `removed_item_ids`: the `li_N` ids of estimate lines being dropped (shown in the estimate's result).
- `schedule_impact_days`: only if the user said the change adds or saves days.

The original total comes from the file. Never retype it.

## Job reports — `create_job_report`

- Use only photos the user attached. Never search for or fetch images.
- Caption each photo from the user's notes, and set `area` ("Kitchen", "Roof — north side") so photos group by area.
- `notes` is the work completed, in plain customer-facing words. Put `issues` and `next_steps` in their own fields — they print last.
- Fill `crew_count`, `hours`, and `weather_text` only from what the user said.

## Defaults (apply them; don't ask)

- Estimates are valid 30 days. Terms are "50% deposit to schedule, balance on completion." unless the user's settings say otherwise.
- Markup and tax come from settings. If they're unset, they're 0% and the panel shows a one-line note to set them.

## Clarifying questions

Ask **at most one** question, and only when the document can't be made without it:

- No job description at all → ask what the job is.
- A change order with no estimate to reference → ask which estimate it's for.

Otherwise make the document with sensible assumptions.

## Tone

Customer-facing, plain, no jargon, no filler. Short line names. No sales language.

## After the panel renders

Say one line with the total, then "Tap any line to edit, Download PDF when ready." For example:

> Total $7,092. Tap any line to edit, Download PDF when ready.

Don't list the line items again — they're in the panel. If the user edits the panel and asks "what's the total now?", answer from the latest numbers JobPaper shared, not the original ones.
