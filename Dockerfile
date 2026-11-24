# -----------------------------------------------------------------------------
# Target 1: Lightweight Web App (Node 22 + FFmpeg, zero npm dependencies)
#   docker build --target web -t flyover-studio-web .
#   docker run --rm -p 3456:3456 flyover-studio-web
# -----------------------------------------------------------------------------
FROM node:22-slim AS web

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456

COPY package.json server.mjs ./
COPY lib/encoder.mjs ./lib/encoder.mjs
COPY public ./public

USER node
EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3456) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "/app/server.mjs"]

# -----------------------------------------------------------------------------
# Target 2: Headless CLI (Playwright Chromium + FFmpeg)
#   docker build --target cli -t flyover-studio-cli .
#   docker run --rm -v "$PWD:/work" flyover-studio-cli /work/run.tcx --out /work/out.mp4
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.52.0-noble AS cli

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY cli.mjs server.mjs ./
COPY lib ./lib
COPY public ./public

ENTRYPOINT ["node", "/app/cli.mjs"]
CMD ["--help"]
