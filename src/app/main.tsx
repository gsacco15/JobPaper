import { createRoot } from "react-dom/client";
import "./styles.css";
import { App, type Screen } from "./App.js";
import { createBridge } from "./bridge.js";

// Inside ChatGPT the panel runs in an iframe. Opened directly (local preview or
// screenshots), it shows sample documents: ?demo=estimate|change_order|job_report|home|logo&mode=inline&theme=dark
const embedded = window.parent !== window;
const bridge = createBridge(embedded);

async function start() {
  let initial: { screen?: Screen; logo?: string; displayMode?: string } | undefined;
  if (!embedded) {
    const params = new URLSearchParams(location.search);
    const demo = params.get("demo") ?? "estimate";
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
    if (theme) document.documentElement.style.colorScheme = theme;
    const { demoDoc } = await import("./demo.js");
    initial = {
      displayMode: params.get("mode") ?? "fullscreen",
      screen: demo === "home" ? { kind: "home" } : demo === "logo" ? { kind: "logo" } : { kind: "doc", doc: demoDoc(demo) },
    };
  }
  createRoot(document.getElementById("root")!).render(<App bridge={bridge} initial={initial} />);
}

void start();
