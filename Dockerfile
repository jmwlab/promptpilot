# syntax=docker/dockerfile:1.6
#
# Multi-stage build for PromptPilot.
# Stage 1 (builder): installs frontend deps and produces the Vite production bundle.
# Stage 2 (runner):  installs only the Node.js server deps and serves /app/dist.
#
# Build:  docker build -t promptpilot:latest .
# Run:    docker run --rm -p 8080:8080 promptpilot:latest

# ---------- Stage 1: build the SPA ----------
FROM node:20-alpine AS builder

WORKDIR /build

# Install frontend dependencies first (better layer caching).
COPY package.json ./
# Lockfile is optional; copy if present.
COPY bun.lockb* package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN npm install --no-audit --no-fund --legacy-peer-deps

# Copy the rest of the source and build.
COPY . .
RUN npm run build

# ---------- Stage 2: minimal runtime ----------
FROM node:20-alpine AS runner

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Install only the server's runtime deps.
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# Copy server source and the built static assets.
COPY server/server.mjs ./server/server.mjs
COPY --from=builder /build/dist ./dist

# Run as the built-in non-root "node" user.
RUN chown -R node:node /app
USER node

EXPOSE 8080

# Container-level healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]