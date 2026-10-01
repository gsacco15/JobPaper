---
name: setup
description: Set up JobPaper's business details — business name, phone, email, default markup, sales tax, and payment terms — when the user chooses Set up for JobPaper or asks to set up their business info.
---

# Set up JobPaper

Help the user put their business details on every estimate, change order, and report. Call `settings.read` with `{}` to see what's saved.

Ask in one short message, and let them skip anything:

1. Business name and phone number (email is optional).
2. Default markup % and sales tax % (fine to leave at 0).

Then call `settings.update` with a `set` object containing only what they gave you. For example:
`{"set":{"business_name":"Ruiz & Sons Remodeling","phone":"(512) 555-0142","default_markup_pct":10,"default_tax_pct":8.25}}`.
Keep the default payment terms unless they ask to change them. Confirm from the values the tool returns; if the tool fails, say so and don't claim it saved.

Tell them they can add a logo from JobPaper's settings (Logo), then offer to write up their first estimate: "Tell me about a job and I'll write up the estimate." If they installed JobPaper in the middle of a task, go back to that task.
