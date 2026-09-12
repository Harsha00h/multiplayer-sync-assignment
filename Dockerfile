# One process: the sync server serves the built client and the WebSocket on the same port.
FROM node:22-alpine

WORKDIR /app

# Install with the lockfile before copying source, so dependency layers cache.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
ENV SYNC_LOG=quiet
EXPOSE 8787

CMD ["npm", "start"]
