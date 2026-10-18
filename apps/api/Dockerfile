# Dibangun dari root repo: docker build -f apps/api/Dockerfile .
# Image Playwright sudah berisi Chromium beserta library sistemnya untuk PDF CV.
# Versinya harus sama dengan playwright-core di apps/api/package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @lokerin/api...

COPY apps/api apps/api
RUN pnpm --filter @lokerin/api build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER pwuser
CMD ["node", "apps/api/dist/server.js"]
