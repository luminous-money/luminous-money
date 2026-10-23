# syntax=docker/dockerfile:1
# Stages:
#   uv       the toolchain (also used to update uv.lock)
#   test     runs the test suite at build time, so building this target means testing; the image
#            is kept for running the benchmark
#   openapi  just the API schema, consumed by packages/ledger-client
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

FROM base AS test
RUN uv sync --frozen
COPY tests ./tests
COPY bench ./bench
RUN pytest -q -p no:cacheprovider
CMD ["pytest", "-q", "-p", "no:cacheprovider"]

FROM base AS openapi-build
RUN python -m ledger.openapi > /openapi.json

FROM scratch AS openapi
COPY --from=openapi-build /openapi.json /

FROM base AS runtime
ENV LEDGER_DATA_DIR=/data
# The same UID as the other services' `node` user, so all of them can share the data volume.
RUN useradd --uid 1000 --create-home ledger && mkdir /data && chown ledger:ledger /data
USER ledger
VOLUME /data
EXPOSE 8000
# Its health (its /health): what `docker compose ps`, `up --wait` and swarm go by.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
# The release it is (docker-bake.hcl passes VERSION), for /health and the system page.
ARG VERSION=dev
ENV LUMINOUS_MONEY_VERSION=${VERSION}
CMD ["uvicorn", "ledger.api:from_env", "--factory", "--host", "0.0.0.0", "--port", "8000"]
