# Commerce OS runs as one persistent Node process: the SQLite file, the
# in-process event bus and the open SSE stream all live in the same instance.
# That is why this is a container image and not a serverless bundle.
#
#   docker build -t commerce-os .
#   docker run -p 3000:3000 commerce-os
#
# Node 24 is required, not preferred — the database uses the built-in
# `node:sqlite`, which does not exist in Node 20 or 22.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/commerce.db

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# The demo database is written at runtime. No volume is required: the seed is
# deterministic, so a fresh container comes up with the identical dataset.
# Mount a volume here only if approvals and audit rows should survive a restart.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
