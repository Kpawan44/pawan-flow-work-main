# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Install ALL dependencies (including devDependencies) and compile:
#   1. vite build       → frontend assets into dist/
#   2. esbuild          → server.ts bundle into dist/server.cjs
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so this layer is cached unless deps change
COPY package*.json ./
RUN npm ci

# Copy source files needed for the build
COPY . .

# Run the same build script used locally
RUN npm run build

# ─── Stage 2: Production image ────────────────────────────────────────────────
# Start clean, install only production deps, copy compiled output
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Copy runtime config files the server needs
COPY firebase-applet-config.json ./firebase-applet-config.json
COPY server.ts ./server.ts

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
