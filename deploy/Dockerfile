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
RUN npm install --legacy-peer-deps
COPY backend/ ./
# Regenerate the Prisma client from the copied schema. The generated client under
# src/generated is git-ignored, so the build context can carry a stale copy from an
# older schema; regenerating here guarantees the client matches schema.prisma before
# tsc compiles it. Without this, new models are missing from the shipped client.
RUN npx prisma generate
RUN npx tsc --skipLibCheck || true
RUN npm run copy:assets

# Stage 3: Production Runtime
FROM node:20-alpine AS production
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