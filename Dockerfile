# ─────────────────────────────────────────
# Build stage
# ─────────────────────────────────────────
FROM node:22.0.0-slim AS builder

WORKDIR /app

# Copiar ambos archivos explícitamente
COPY ./app/package.json ./app/package-lock.json ./

# npm ci garantiza build reproducible con el lock file
RUN npm ci

COPY ./app/ ./

RUN npm run build

# ─────────────────────────────────────────
# Production stage
# ─────────────────────────────────────────
FROM node:22.0.0-slim AS runner

ENV NODE_ENV=production

# Buena práctica: no correr como root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# Copiar solo lo necesario del builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Usar el usuario no-root
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Next.js genera un server.js standalone, úsalo directamente
CMD ["node", "server.js"]
