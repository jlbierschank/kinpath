# Kinpath clinic server (web app + the API the phone app calls).
# Build:  docker build -t kinpath .
# Run:    docker run -p 3000:3000 --env-file .env.production kinpath
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/clinic/package.json apps/clinic/
COPY apps/patient/package.json apps/patient/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @kinpath/clinic...

FROM deps AS build
COPY . .
RUN pnpm --filter @kinpath/db gen && pnpm --filter @kinpath/clinic build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S kinpath && adduser -S kinpath -G kinpath
COPY --from=build --chown=kinpath:kinpath /app/apps/clinic/.next/standalone ./
COPY --from=build --chown=kinpath:kinpath /app/apps/clinic/.next/static ./apps/clinic/.next/static
COPY --from=build --chown=kinpath:kinpath /app/apps/clinic/scripts ./apps/clinic/scripts
USER kinpath
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/clinic/server.js"]
