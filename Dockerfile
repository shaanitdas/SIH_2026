# syntax=docker/dockerfile:1

# SIH PrivacyGuard planner server — multi-stage build.
# The extension itself is distributed separately (Load unpacked / Chrome Web Store);
# this image runs the local planner API on http://0.0.0.0:8080.

FROM node:24-alpine AS base
WORKDIR /app

# --- install all deps (incl. build tooling) ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
RUN npm ci

# --- compile shared + server ---
FROM deps AS build
COPY . /app
RUN npm run build --workspace @sih/shared && npm run build --workspace @sih/server

# --- runtime: production deps only, then built code ---
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    LOG_LEVEL=info
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
RUN npm ci --omit=dev --include-workspace-root && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist

EXPOSE 8080
WORKDIR /app
CMD ["node", "apps/server/dist/index.js"]