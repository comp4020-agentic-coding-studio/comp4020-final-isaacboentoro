# syntax = docker/dockerfile:1

# One Node process: HTTP, the WebSocket and SQLite (node:sqlite, built in) all
# live in it, so the 256 MB machine runs nothing else. Node runs the
# TypeScript in server/ directly, so there's no build step.
FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY server/ server/
COPY public/ public/
COPY README.md ./
COPY docs/ docs/
CMD ["node", "server/main.ts"]
