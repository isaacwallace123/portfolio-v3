# Build context: the repo ROOT (monorepo). Builds the admin app + its workspace dep @iw/core.
# Run via compose (context: ., dockerfile: apps/admin/Dockerfile). See apps/web/Dockerfile for notes.

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
COPY apps/admin ./apps/admin
ARG NEXT_PUBLIC_API_URL=http://localhost:5180
ARG NEXT_PUBLIC_AUTH_API_URL=http://localhost:5170
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
RUN npm run build -w apps/admin

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
