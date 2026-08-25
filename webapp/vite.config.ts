import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type ViteDevServer } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "e2e"
      ? [
          {
            name: "e2e-api-fallback",
            configureServer(server: ViteDevServer) {
              server.middlewares.use((request, response, next) => {
                if (request.url === "/api/v1/health") {
                  response.setHeader("content-type", "application/json");
                  response.end(JSON.stringify({ data: { status: "ok" } }));
                  return;
                }
                if (request.url?.startsWith("/api/")) {
                  response.statusCode = 404;
                  response.setHeader("content-type", "application/json");
                  response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
                  return;
                }
                next();
              });
            },
          },
        ]
      : [
          cloudflare({
            configPath: "../wrangler.jsonc",
            inspectorPort: false,
            persistState: false,
          }),
        ]),
  ],
}));
