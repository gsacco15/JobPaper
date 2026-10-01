# Decisions and platform checks

The v1 spec was written before the OpenAI MCP Extensions spec and the `@openai/mcp-extensions` SDK (v0.1.0) were published. This file records where the build follows the published spec instead, and what still needs to be confirmed in a real ChatGPT client.

## Where the build differs from the v1 spec

| Spec said | Built | Why |
| --- | --- | --- |
| One tool `_meta` block with thread + global + file entrypoints on the document tool | Separate entrypoint tools: `open_jobpaper` (global + thread, accepts `{}`) and `open_document_file` (file, accepts `FileInput`) | The published spec requires global/thread tools to accept `{}` and file tools to accept `{ file: { name, resourceUri } }`. `create_estimate` requires `job_description`, so it can't be an entrypoint. The three document tools point at the same panel (`ui://jobpaper/document-v1`). |
| `extensions: ["est.json", …]` | `[".est.json", ".co.json", ".rpt.json"]` | The spec requires the HTML `accept` form with a leading dot. |
| Panel "writes the document as a file into the chat" | Each tool result includes a `resource_link` named `<title>.est.json` whose URI holds the document (`jobpaper://doc/<name>?z=<base64url zlib JSON>` — compressed with a checksum so the model can pass it back intact, and a garbled copy is rejected rather than misread); edits go into model context as an embedded resource with the same naming; files opened via the file viewer are saved with `openai/resources/write` | The spec has no API for an app to create a new chat file. Apps can only write the file they were opened with. The self-contained URI keeps the server stateless and lets `create_change_order` read the estimate with no database. |
| `window.openai.setWidgetState` | `ui/update-model-context` (via `OpenAIExtensions.modelContext`) | That's the MCP Apps equivalent. Each update replaces the last, so the model always sees the current totals. |
| Settings: plain JSON schema including `logo_data_url` | Native settings fields for name/phone/email/markup/tax/terms, plus a **Logo** button (settings tool item) that opens the panel's logo uploader | Native settings only render primitive fields. Pasting a data URL into a text box isn't usable. The panel downsizes the image to ≤480px. |
| "No database" | Settings need storage: the spec says "MCP Servers are responsible for persisting settings". One KV record per user, keyed by `sha256("jobpaper:" + openai/subject)`. Documents are never stored. | The only option without accounts. |
| Inline card: one "Open" button | "Open" plus a small "PDF" button | Gets to a sendable PDF in 2 taps from the chat (the spec's rule is 3 or fewer). Drop it if review objects. |
| Change orders numbered per estimate | Chained: pass the latest `.co.json` and CO-2 starts from CO-1's new total (`previous_total`). The original estimate total is kept on every CO. | Stateless numbering. The skill tells the model to pass the latest CO file. |
| `create_change_order` reads the estimate file | If `estimate_file` is a `jobpaper://` URI (or pasted JSON), the server builds the CO. If it's a host file URI the server can't read, the tool returns `pending`, and the panel reads the file through the host and finishes the CO with the same shared math. | ChatGPT intercepts host resource reads for apps, not for servers. |
| `photos[]` image resource URIs | Accepts URI strings or `{ uri | download_url, caption, area }` | So the model can pass captions and areas for grouping. |

## Day-1 checks in a real ChatGPT client

Run these in developer mode before submitting. Record the answers here.

1. **File chips.** Does a `resource_link` named `X.est.json` in a tool result show up as a file in the chat, and does tapping it open `open_document_file`? (File entrypoints are desktop-only per the spec's platform table.)
   - If double extensions don't match: change `DOC_EXTENSIONS` in `src/shared/document.ts` to `.estimate`, `.changeorder`, `.jobreport`. Everything else derives from it.
2. **`openai/subject`.** Confirm it arrives in `_meta` on `tools/call` for both model calls and settings calls. If settings calls lack it, settings can't be saved (the server returns an error rather than sharing a record between users).
3. **Downloads.** Does `ui/download-file` with a base64 PDF blob save the file on iOS, Android, and desktop? The panel falls back to an `<a download>` link if the host refuses.
4. **Photo URIs.** What URIs does the model get for attached images, and do they load in the panel? Add the origins to `JOBPAPER_PHOTO_DOMAINS` (CSP `resourceDomains`). Otherwise the panel reads them through the host.
5. **Clipboard.** Does Copy as text work in the iframe (`permissions.clipboardWrite` is requested)? There's an `execCommand` fallback.
6. **Display modes.** Does "Open" move from inline to fullscreen on mobile? If `requestDisplayMode` is refused, the panel expands in place.

## Verified here

- Unit tests for all math, chaining, normalization, the URI codec, and SMS text.
- MCP integration tests through the real Streamable HTTP handler (tools, annotations, entrypoint `_meta`, settings capability, per-user settings isolation, resource template reads).
- End-to-end tests: a fake host (`test/e2e/host.ts`, built on `AppBridge`) renders the real bundled panel in a sandboxed iframe, talking to the real server. It covers the inline card → fullscreen, editing → model context, PDF via `ui/download-file`, remembered markup/tax, file open → `openai/resources/write`, Make a change order → `ui/message`, a pending CO finished in the panel, Open original estimate, the home screen, and the broken-photo placeholder.
