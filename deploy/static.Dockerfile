# Static front ends (deployment §4): the Vite build of one app served by Caddy with
# deploy/Caddyfile (cache rules, SPA fallback, security headers, CSP). Build from the repo root:
#   docker build -f deploy/static.Dockerfile --build-arg APP=pos \
#     --build-arg VITE_API_URL=https://api.naqd.pk --build-arg VITE_POS_URL=https://pos.naqd.pk \
#     -t naqdpos-pos .
# APP is pos or admin. VITE_* are build-time (baked into the JavaScript); API_ORIGIN and
# FILES_ORIGIN (CSP) are read by Caddy at run time from the service's variables.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY db/package.json db/
COPY e2e/package.json e2e/
ARG APP
RUN test "$APP" = pos || test "$APP" = admin
RUN pnpm install --frozen-lockfile --filter "@naqdpos/${APP}..."

COPY packages/core packages/core
COPY apps/${APP} apps/${APP}
ARG VITE_API_URL
ARG VITE_POS_URL
# Fail the build rather than ship an app that calls nowhere.
RUN test -n "$VITE_API_URL" && pnpm --filter "@naqdpos/${APP}" build

FROM caddy:2.11.9-alpine
ARG APP
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/${APP}/dist /srv
ENV SITE_ROOT=/srv
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
