# ── Stage 1: Build React / Vite app ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfiles first — better layer caching
COPY package*.json ./
RUN npm ci --silent

# Copy source
COPY index.html vite.config.js ./
COPY src/ ./src/
COPY public/ ./public/

# Build — VITE_BACKEND_URL is intentionally NOT set here.
# The frontend uses the relative path /api which nginx proxies internally.
RUN npm run build


# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Drop default config
RUN rm /etc/nginx/conf.d/default.conf

# Inject our config (listens on port 80)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
