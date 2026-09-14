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

# Staging Cloud Build should pass these so Vite inlines staging Firebase into the browser bundle:
#   --build-arg APP_ENV=staging
#   --build-arg GCP_PROJECT=pmw-tracker-staging-9ca72
#   --build-arg FIRESTORE_DATABASE_ID=ai-studio-staging
#   --build-arg VITE_APP_ENV=staging
#   --build-arg VITE_FIREBASE_PROJECT_ID=pmw-tracker-staging-9ca72
#   --build-arg VITE_FIRESTORE_DATABASE_ID=ai-studio-staging
# Production builds omit them and keep firebase-applet-config.json (my-project-9ca72).
ARG APP_ENV
ARG GCP_PROJECT
ARG FIRESTORE_DATABASE_ID
ARG VITE_APP_ENV
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIRESTORE_DATABASE_ID
ENV APP_ENV=$APP_ENV
ENV GCP_PROJECT=$GCP_PROJECT
ENV FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID
ENV VITE_APP_ENV=$VITE_APP_ENV
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIRESTORE_DATABASE_ID=$VITE_FIRESTORE_DATABASE_ID

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
