# NaqdPOS API image (deployment §1). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t naqdpos-api .
# One image, three uses (Railway config in apps/api/railway*.json):
#   API          node src/server.ts                     (default command)
#   worker       node src/worker.ts                     (pg-boss jobs: nightly backup)
#   pre-deploy   node /repo/db/scripts/migrate.ts       (migrations with DATABASE_ADMIN_URL)
# All settings come from environment variables at run time (deployment §2).
# Alpine pinned to 3.24: it ships postgresql18-client, and a silent base change can't swap it.
FROM node:24-alpine3.24

# pg_dump / pg_restore must be at least the server's major version (Postgres 18, deployment §1).
RUN apk add --no-cache postgresql18-client \
  && pg_dump --version | grep -q ' 18\.'

RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached between code changes. Every workspace
# member's package.json is needed for pnpm to accept the frozen lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY db/package.json db/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --prod --filter "@naqdpos/api..." --filter "@naqdpos/db"

# No build step: Node 24 runs the TypeScript directly (type stripping). Workspace packages stay
# symlinks, so @naqdpos/core is loaded from packages/core/src, outside node_modules.
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY apps/api/scripts apps/api/scripts
COPY db/migrations db/migrations
COPY db/scripts/migrate.ts db/scripts/migrate.ts

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
WORKDIR /repo/apps/api
CMD ["node", "src/server.ts"]
