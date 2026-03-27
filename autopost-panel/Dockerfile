# From monorepo root:
#   docker build -f autopost-panel/Dockerfile .
FROM node:22-bookworm
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY autopost-panel ./autopost-panel
COPY src ./src
COPY assets ./assets
COPY scripts ./scripts
RUN mkdir -p tmp/reels

ENV TT_REPO_ROOT=/app
ENV NODE_ENV=production

# tsx is a root dependency so publish-next-once.ts can run in the image.
RUN pnpm install --frozen-lockfile
RUN pnpm --filter autopost-panel build

WORKDIR /app
EXPOSE 3000
CMD ["sh", "-c", "cd /app && PORT=${PORT:-3000} pnpm --filter autopost-panel start"]
