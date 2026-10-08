# syntax=docker/dockerfile:1
# Fava, unmodified, serving the exports that `ledger` writes. Beancount is pinned to the same
# version as services/ledger/uv.lock so both report the same booking and validation results.
# Any third-party Beancount plugin a book uses has to be installed here and in `ledger`.

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
RUN uv pip install --system --no-cache "fava==1.30.16" "beancount==3.2.3"
COPY entrypoint.sh /usr/local/bin/fava-entrypoint
ENV FAVA_HOST=0.0.0.0 FAVA_PORT=5000 FAVA_PREFIX=/fava EXPORT_DIR=/exports
EXPOSE 5000
ENTRYPOINT ["fava-entrypoint"]
