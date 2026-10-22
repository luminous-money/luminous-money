# syntax=docker/dockerfile:1
# The gateway: Traefik at a pinned version with fava-beans' routes inside, so a release brings its
# own routes and a deployment needs only compose.yaml and its .env. Its static configuration is
# written at start from the environment (entrypoint.sh): plain HTTP on one port, or HTTPS with a
# Let's Encrypt certificate when FAVA_BEANS_DOMAIN is set.
FROM traefik:v3.7.14
COPY routes.yml /etc/fava-beans/routes.yml
COPY entrypoint.sh /usr/local/bin/fava-beans-gateway
RUN chmod +x /usr/local/bin/fava-beans-gateway && mkdir -p /etc/traefik /certs
VOLUME /certs
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["traefik", "healthcheck", "--configFile=/etc/traefik/traefik.yml"]
ARG VERSION=dev
ENV FAVA_BEANS_VERSION=${VERSION}
ENTRYPOINT ["/usr/local/bin/fava-beans-gateway"]
