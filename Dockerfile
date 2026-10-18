# docker build -t lokerin-backend .
# Image Playwright sudah berisi Chromium beserta library sistemnya untuk PDF CV.
# Versinya harus sama dengan playwright-core di package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle drizzle
COPY src src
RUN pnpm build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER pwuser
CMD ["node", "dist/server.js"]
