# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
COPY backend/prisma ./prisma/
# Reproducible install: `npm ci` installs the exact tree from the committed
# backend/package-lock.json (this stage builds backend standalone — no workspace
# root — so a backend-scoped lockfile is what pins it). The lockfile was
# generated in THIS image (node:20-alpine) so the versions match bit-for-bit.
# An `overrides` pin on @types/express-serve-static-core (5.1.0) holds the
# Express request-typing surface steady; without it a floated 5.1.3 retypes
# req.query/req.params as `string | string[]` and breaks tsc across ~160 sites.
RUN npm ci --legacy-peer-deps
COPY backend/ ./
# Regenerate the Prisma client from the copied schema. The generated client under
# src/generated is git-ignored, so the build context can carry a stale copy from an
# older schema; regenerating here guarantees the client matches schema.prisma before
# tsc compiles it. Without this, new models are missing from the shipped client.
# `prisma.config.ts` eagerly resolves a datasource URL and throws when no DB env is
# present; generate never connects, so feed it a throwaway URL to satisfy the config
# while keeping the strict env check intact for real (runtime) migrations.
RUN DATABASE_URL="mysql://build:build@127.0.0.1:3306/build" npx prisma generate
# Type gate: the reproducible install above makes this deterministic, so the
# image build now fails on type errors (belt-and-suspenders with the pre-deploy
# `npm run typecheck`). Verified clean in this exact image before `|| true` was
# removed — see docs/maintenance_cadence.md.
RUN npx tsc --skipLibCheck
RUN npm run copy:assets

# Stage 3: Production Runtime
FROM node:20-alpine AS production
# Run the container in Eastern so DATETIME handling matches dev/stage/prod. The
# app also pins process.env.TZ=America/New_York at startup
# (backend/src/config/timezone.ts); tzdata provides the zone database that Alpine
# needs to resolve the named zone, and this keeps OS-level tooling (logs, cron,
# `date`) consistent as belt-and-suspenders.
RUN apk add --no-cache tzdata
ENV TZ=America/New_York
RUN npm install --legacy-peer-deps -g pm2
WORKDIR /app

# Copy built backend assets
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package*.json ./backend/

# Copy built frontend static files
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy configuration files
COPY ecosystem.config.cjs ./
COPY deploy/production_environment_template.env ./.env.example

EXPOSE 5000

CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]