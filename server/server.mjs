// Minimal Node.js (Express) static web server for the PromptPilot SPA.
// Serves the Vite production build from /app/dist and falls back to index.html
// so that client-side React Router routes resolve correctly.
//
// Run locally:   node server/server.mjs
// Inside Docker: the container CMD invokes this file.

import express from "express";
import compression from "compression";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// The Dockerfile copies the build output into /app/dist.
// When running outside Docker, fall back to ../dist relative to this file.
const DIST_DIR = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : fs.existsSync("/app/dist")
    ? "/app/dist"
    : path.resolve(__dirname, "..", "dist");

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[promptpilot] dist directory not found at ${DIST_DIR}`);
  console.error(`[promptpilot] run \`bun run build\` (or \`npm run build\`) before starting the server.`);
  process.exit(1);
}

const app = express();

// Security headers. We relax some CSP directives because the app embeds
// YouTube (youtube-nocookie.com) and Tailwind ships inline styles.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-src": [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
        ],
        "frame-ancestors": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());

// Health endpoint for Docker / Proxmox healthchecks.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Long-cache static assets (hashed filenames from Vite); short-cache HTML.
app.use(
  express.static(DIST_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(js|css|woff2?|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

// SPA fallback: any non-file route returns index.html so React Router can take over.
app.get("*", (_req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[promptpilot] serving ${DIST_DIR}`);
  console.log(`[promptpilot] listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown so the container stops promptly.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[promptpilot] received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}
