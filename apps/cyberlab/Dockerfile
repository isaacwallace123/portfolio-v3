# Build context: the repo ROOT (monorepo). Builds the cyberlab app + its workspace dep @iw/core.
# Run via compose (context: ., dockerfile: apps/cyberlab/Dockerfile). See apps/web/Dockerfile for notes.

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/auth/package.json apps/auth/
COPY apps/admin/package.json apps/admin/
COPY apps/cyberlab/package.json apps/cyberlab/
RUN npm install --no-audit --no-fund

COPY packages ./packages
COPY apps/cyberlab ./apps/cyberlab
# NEXT_PUBLIC_* is inlined into the client bundle at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:5180
ARG NEXT_PUBLIC_AUTH_API_URL=http://localhost:5170
ARG NEXT_PUBLIC_AUTH_URL=http://localhost:3005
ARG NEXT_PUBLIC_ADMIN_URL=http://localhost:3004
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
ENV NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
RUN npm run build -w apps/cyberlab

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /repo/apps/cyberlab/.next/standalone ./
COPY --from=build /repo/apps/cyberlab/.next/static ./apps/cyberlab/.next/static
EXPOSE 3000
CMD ["node", "apps/cyberlab/server.js"]
