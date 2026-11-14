FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS api
ENV UV_LINK_MODE=copy UV_NO_DEV=1 PATH="/app/server/.venv/bin:${PATH}" \
    FARM_DATA_DIR=/data FARM_API_HOST=0.0.0.0 FARM_API_PORT=8700 \
    FARM_WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY server/ ./
RUN uv sync --frozen --no-dev
COPY --from=web-build /app/web/dist /app/web/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 8700
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8700/api/v1/healthz', timeout=3)" || exit 1
CMD ["farm", "api"]

FROM api AS agent
ARG MAESTRO_VERSION=2.12.0
COPY ops/scrcpy/ /app/ops/scrcpy/
RUN apt-get update && apt-get install -y --no-install-recommends \
    adb openjdk-17-jre-headless curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --silent --show-error \
      "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip" \
      -o /tmp/maestro.zip \
    && unzip -q /tmp/maestro.zip -d /opt \
    && rm /tmp/maestro.zip
ENV PATH="/opt/maestro/bin:${PATH}"
CMD ["farm", "agent"]
