FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY firebase-applet-config.json ./firebase-applet-config.json
COPY server.ts ./server.ts

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
