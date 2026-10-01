Please create a plugin called **JobPaper** that connects to my existing, already-deployed MCP server. Do not build a new server or replace its tools — the server, its tools, its interactive panel (MCP App), and its settings are finished and live. I need the plugin wrapper: connection, listing details, and skills.

## Connection
- MCP server URL: https://jobpaperapp.com/mcp
- Transport: Streamable HTTP
- Authentication: none
- Health check: GET https://jobpaperapp.com/mcp returns {"status":"ok"}

## Listing
- Name: JobPaper
- Developer: JobPaper
- Category: Productivity
- Short description: Estimates, change orders, and job reports as PDFs
- Long description: JobPaper turns a contractor's notes and photos into three documents: an estimate, a change order, or a daily/weekly job report. The document opens as an editable panel: tap any line to change it, then Download PDF or Copy as text. Totals, markup, and sales tax are calculated from your business settings. Estimates are saved as files in the chat, so a change order can reference the original estimate and its total.
- Capabilities: Interactive, Read
- Logo: https://jobpaperapp.com/logo.svg (PNG: https://jobpaperapp.com/icon-512.png)
- Website: https://jobpaperapp.com
- Privacy policy: https://jobpaperapp.com/privacy
- Terms: https://jobpaperapp.com/terms
- Support: support@jobpaperapp.com
- Default prompt: Write up an estimate for a bathroom remodel
- No pricing, plans, Pro, or upgrade language anywhere.

## Tools the server already provides (use as-is)
- create_estimate — job_description (required), line_items[] (name, qty, unit, unit_price), client_name, job_address_text, notes
- create_change_order — estimate_file (required: resource URI of the saved estimate or latest change order), change_description (required), added_items[], removed_item_ids[], schedule_impact_days
- create_job_report — job_name (required), notes (required), period (daily|weekly), photos[], crew_count, hours, weather_text, issues, next_steps
- open_jobpaper — sidebar and thread entrypoint (opens the JobPaper home panel)
- open_document_file — file viewer for .est.json, .co.json, .rpt.json
- settings.read / settings.update — plugin settings: business name, phone, email, default markup %, sales tax %, payment terms (plus a Logo button)
All document tools are read-only, non-destructive, closed-world: they only return a document; the server computes all totals.

## Skill 1 — "jobpaper" (when and how to use the tools)
Use JobPaper when the user wants a customer-facing paper for a trade job:
- Estimates: "write up an estimate for…", "put together a quote for…", "bid for a…", "price out a…"
- Change orders: "change order for…", "the customer added…", "they want to add… to the job"
- Job reports: "daily report for the … job", "job report from these photos", "end of day report", "weekly update for the homeowner"
Trades: remodel, bathroom, kitchen, roof, fence, deck, drywall, paint, HVAC, plumbing, electrical, landscaping, concrete, flooring, tile. Not for invoices, scheduling, or client lists.

Estimates: before calling create_estimate, draft 3–10 plain-English line items (like a text to the customer), split labor/materials only if the user mentions both, units job/hr/sq ft/ln ft/each, prices rounded to the dollar. Pass client_name and job_address_text only if the user typed them; never look up a location. Never compute totals — the server does.

Change orders: estimate_file is the resource URI of the saved .est.json (the link returned with the estimate, or a file the user opened/attached). If the job already has a change order, pass the latest .co.json so numbering continues (CO-1, CO-2). removed_item_ids are the li_N ids from the estimate. The original total comes from the file; never retype it.

Job reports: only use photos the user attached; caption them from the user's notes and set an area so they group. Put issues and next steps in their own fields.

Defaults (never ask): estimates valid 30 days; terms "50% deposit to schedule, balance on completion" unless settings say otherwise; markup and tax from settings.

Ask at most one question, and only if the document can't be made (no job description, or a change order with no estimate). Otherwise make it with sensible assumptions.

After the panel renders, say one line: the total, then "Tap any line to edit, Download PDF when ready." Don't repeat the line items. If the user edits the panel and asks for the total, use the latest numbers JobPaper shared.

## Skill 2 — "setup" (onboarding skill)
Help the user add their business details. Call settings.read with {}. Ask in one short message for business name and phone (email optional) and default markup % and sales tax % (fine to leave 0). Call settings.update with only what they gave, e.g. {"set":{"business_name":"Ruiz & Sons Remodeling","phone":"(512) 555-0142","default_markup_pct":10,"default_tax_pct":8.25}}. Confirm from the returned values. Mention they can add a logo from JobPaper's settings (Logo), then offer: "Tell me about a job and I'll write up the estimate."

When you're done, connect the plugin so I can test it with: "Write up an estimate for a 6 ft cedar fence, 120 linear feet, for the Lees."
