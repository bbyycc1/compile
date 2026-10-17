# ---- deps ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL not needed at build time (db client is lazily initialized)
RUN npm run build

# ---- run ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# standalone server + static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# migrations + runner script (pg ships from the deps stage)
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=deps /app/node_modules/pg ./node_modules/pg
EXPOSE 3000
# migrate on boot, then start
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
