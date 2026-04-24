# Multi-stage Dockerfile for QTIP Application
# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci --only=production

# Copy frontend source and build
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:18-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
RUN npm ci --only=production

# Copy backend source and build
COPY backend/src/ ./src/
RUN npm run build

# Stage 3: Production Runtime
FROM node:18-alpine AS production

# Install PM2 globally
RUN npm install -g pm2

# Create app directory
WORKDIR /app

# Copy built backend
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package*.json ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy configuration files
COPY ecosystem.config.js ./
COPY deploy/production_environment_template.env ./.env.example

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S qtip -u 1001

# Create necessary directories
RUN mkdir -p /app/logs /app/backups && \
    chown -R qtip:nodejs /app

# Install serve for frontend
RUN npm install -g serve

# Switch to non-root user
USER qtip

# Expose ports
EXPOSE 3000 5173

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { hostname: 'localhost', port: 3000, path: '/monitoring/health', timeout: 5000 }; \
    const req = http.request(options, (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Default command
CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"] 