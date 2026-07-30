# Build Stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install development and production dependencies for building
RUN npm ci

# Copy full application source
COPY . .

# Build the application (Vite client + esbuild bundled backend)
RUN npm run build

# Production Stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files for dependency resolution
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built production artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Expose port 3000
EXPOSE 3000

# Start production server
CMD ["node", "dist/server.cjs"]
