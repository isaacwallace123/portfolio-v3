# Build context: the repo ROOT (monorepo). Builds the cyberlab app + its workspace dep @iw/core.
# Run via compose (context: ., dockerfile: apps/cyberlab/Dockerfile). See apps/web/Dockerfile for notes.

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/lab-runtime/package.json packages/lab-runtime/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/cyberlab/package.json apps/cyberlab/
COPY apps/homelab/package.json apps/homelab/
COPY apps/ailab/package.json apps/ailab/
RUN npm install --no-audit --no-fund

COPY packages ./packages
COPY apps/cyberlab ./apps/cyberlab
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
RUN npm run build -w apps/cyberlab

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /repo/apps/cyberlab/.next/standalone ./
COPY --from=build /repo/apps/cyberlab/.next/static ./apps/cyberlab/.next/static
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs \
    && chown -R nextjs:nodejs /repo
USER nextjs
EXPOSE 3000
CMD ["node", "apps/cyberlab/server.js"]
