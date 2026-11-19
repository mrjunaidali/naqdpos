# NaqdPOS API image (deployment §1). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t naqdpos-api .
# All settings come from environment variables at run time (deployment §2).
FROM node:24-alpine

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
RUN pnpm install --frozen-lockfile --prod --filter "@naqdpos/api..."

# No build step: Node 24 runs the TypeScript directly (type stripping). Workspace packages stay
# symlinks, so @naqdpos/core is loaded from packages/core/src, outside node_modules.
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
WORKDIR /repo/apps/api
CMD ["node", "src/server.ts"]
