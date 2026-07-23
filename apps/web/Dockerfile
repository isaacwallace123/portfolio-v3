# Build context: the repo ROOT (monorepo). Builds the web app together with its workspace
# dependency @iw/core. Run via compose (context: ., dockerfile: apps/web/Dockerfile).
#
# npm nests each workspace's deps under apps/<app>/node_modules (not hoisted), so install + build
# happen in ONE stage — a cross-stage `COPY node_modules` would drop the nested trees.

FROM node:26-alpine AS build
WORKDIR /repo
# Manifests first so `npm install` is cached until a package.json changes. All workspaces must be
# present for npm to resolve the graph.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/lab-runtime/package.json packages/lab-runtime/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/cyberlab/package.json apps/cyberlab/
COPY apps/homelab/package.json apps/homelab/
COPY apps/ailab/package.json apps/ailab/
# npm install (not ci): the lockfile is authored on Windows but this image is alpine/musl —
# native bindings differ per platform, which npm ci's strict check rejects.
RUN npm install --no-audit --no-fund

# Source (busts only the build layer, not the install layer)
COPY packages ./packages
COPY apps/web ./apps/web
# NEXT_PUBLIC_* is inlined into the client bundle at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:5180
ARG NEXT_PUBLIC_AUTH_API_URL=http://localhost:5170
ARG NEXT_PUBLIC_ADMIN_URL=http://localhost:3004
ARG NEXT_PUBLIC_HOME_URL=http://localhost:3000
ARG NEXT_PUBLIC_CYBERLAB_URL=http://localhost:3001
ARG NEXT_PUBLIC_HOMELAB_URL=http://localhost:3002
ARG NEXT_PUBLIC_AILAB_URL=http://localhost:3003
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_HOME_URL=$NEXT_PUBLIC_HOME_URL
ENV NEXT_PUBLIC_CYBERLAB_URL=$NEXT_PUBLIC_CYBERLAB_URL
ENV NEXT_PUBLIC_HOMELAB_URL=$NEXT_PUBLIC_HOMELAB_URL
ENV NEXT_PUBLIC_AILAB_URL=$NEXT_PUBLIC_AILAB_URL
RUN npm run build -w apps/web

FROM node:26-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Standalone output is traced from the repo root (outputFileTracingRoot), so it already
# contains apps/web/server.js, the needed node_modules, and packages/core.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs \
    && chown -R nextjs:nodejs /repo
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
