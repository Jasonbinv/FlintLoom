import { homedir } from "node:os";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { loadOrCreateToken } from "@flintloom/host";
import { forwardV1 } from "./src/proxy.ts";

const UPSTREAM = "http://127.0.0.1:7331";

function v1Proxy(): Plugin {
  const token = loadOrCreateToken(homedir());
  return {
    name: "flintloom-v1-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/v1/")) {
          next();
          return;
        }

        try {
          const method = req.method ?? "GET";
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const contentType = req.headers["content-type"];
          const rangeHeader = req.headers.range;

          const forwarded = await forwardV1({
            upstreamOrigin: UPSTREAM,
            token,
            method,
            path: url,
            body,
            contentType: typeof contentType === "string" ? contentType : undefined,
            range: typeof rangeHeader === "string" ? rangeHeader : undefined,
          });

          res.statusCode = forwarded.status;
          if (forwarded.contentType) {
            res.setHeader("Content-Type", forwarded.contentType);
          }
          if (forwarded.contentLength) {
            res.setHeader("Content-Length", forwarded.contentLength);
          }
          if (forwarded.acceptRanges) {
            res.setHeader("Accept-Ranges", forwarded.acceptRanges);
          }
          if (forwarded.contentRange) {
            res.setHeader("Content-Range", forwarded.contentRange);
          }

          if (!forwarded.stream) {
            res.end();
            return;
          }

          for await (const chunk of forwarded.stream) {
            res.write(chunk);
          }
          res.end();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), v1Proxy()],
  optimizeDeps: {
    include: ["chart.js/auto", "pptxviewjs"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
