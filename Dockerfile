# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies (keeps native modules compiled for current arch)
RUN npm prune --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine

# jq is used by run.sh to parse /data/options.json
RUN apk add --no-cache jq

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json

COPY addon/run.sh /run.sh
# Strip Windows CRLF line endings and make executable
RUN sed -i 's/\r$//' /run.sh && chmod a+x /run.sh

EXPOSE 3000

CMD ["/run.sh"]
