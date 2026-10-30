import { colors, tokenCSS, favicon } from "./src/design/tokens";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "velvet-verdict-tokens",
      resolveId(id) {
        if (id === "virtual:velvet-tokens.css") return "\0" + id;
      },
      load(id) {
        if (id === "\0virtual:velvet-tokens.css") return tokenCSS;
      },
      transformIndexHtml(html) {
        return html.replace("__CANVAS__", colors.canvas);
      },
      configureServer(server) {
        server.middlewares.use("/favicon.svg", (_req, res) => {
          res.setHeader("Content-Type", "image/svg+xml");
          res.end(favicon);
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "favicon.svg",
          source: favicon,
        });
      },
    },
  ],
  build: { manifest: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/socket": { target: "ws://localhost:3000", ws: true },
    },
  },
});
