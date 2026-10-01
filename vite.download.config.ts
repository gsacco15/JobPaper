import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src/download",
  base: "./",
  plugins: [viteSingleFile()],
  build: { outDir: "../../dist/download", emptyOutDir: true, target: "es2022" },
});
