# syntax=docker/dockerfile:1
# Stages:
#   uv       the toolchain (also used to update uv.lock)
#   runtime  the default and final stage: the service image

FROM python:3.12-slim AS uv
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

FROM uv AS base
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/venv PATH=/venv/bin:$PATH
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

FROM base AS runtime
ENV SHOPS_DATA_DIR=/data
# Amazon's sign-in is done in a headless Chromium (Playwright's full build, in its new headless
# mode: shops.amazon.browser_sign_in), installed with its system libraries where the service's
# user can read it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
# The same UID as the other services' users, so all of them can share the data volume.
RUN useradd --uid 1000 --create-home shops && mkdir /data && chown shops:shops /data
USER shops
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
# The release it is (docker-bake.hcl passes VERSION), for /health.
ARG VERSION=dev
ENV LUMINOUS_MONEY_VERSION=${VERSION}
CMD ["uvicorn", "shops.api:from_env", "--factory", "--host", "0.0.0.0", "--port", "8000"]
