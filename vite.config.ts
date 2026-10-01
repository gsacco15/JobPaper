import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The panel ships as ONE self-contained HTML resource (ui://jobpaper/document-v1):
// no external scripts, styles, or network calls.
export default defineConfig({
  root: "src/app",
  base: "./",
  plugins: [tailwindcss(), react(), viteSingleFile()],
  resolve: {
    // jsPDF's optional HTML/SVG renderers are never used; keep them out of the bundle.
    alias: {
      html2canvas: fileURLToPath(new URL("src/app/stubs/empty.ts", import.meta.url)),
      dompurify: fileURLToPath(new URL("src/app/stubs/empty.ts", import.meta.url)),
      canvg: fileURLToPath(new URL("src/app/stubs/empty.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "../../dist/app",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 2000,
  },
});
