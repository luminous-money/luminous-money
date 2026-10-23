#!/bin/sh
# Writes the gateway's static configuration from the environment, then runs Traefik.
#
#   LUMINOUS_MONEY_DOMAIN           Serve HTTPS for this domain (ports 80 and 443 must reach it), with a
#                               certificate from Let's Encrypt; HTTP redirects to HTTPS. Unset:
#                               plain HTTP on port 80 (published as LUMINOUS_MONEY_PORT).
#   LUMINOUS_MONEY_ACME_EMAIL       Where Let's Encrypt writes about the certificate. Required with a
#                               domain.
#   LUMINOUS_MONEY_TRUSTED_PROXIES  Addresses (comma-separated, CIDR) whose X-Forwarded-* headers are
#                               believed: a proxy in front that terminates TLS. Default: private
#                               networks and loopback.
set -eu

trusted="${LUMINOUS_MONEY_TRUSTED_PROXIES:-127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7}"
domain="${LUMINOUS_MONEY_DOMAIN:-}"
if [ -n "$domain" ] && [ -z "${LUMINOUS_MONEY_ACME_EMAIL:-}" ]; then
  echo "LUMINOUS_MONEY_DOMAIN needs LUMINOUS_MONEY_ACME_EMAIL (Let's Encrypt's contact for the certificate)" >&2
  exit 1
fi

# One YAML list item per address, indented under trustedIPs.
ips() {
  echo "$trusted" | tr ',' '\n' | sed -e 's/^ *//' -e 's/ *$//' -e '/^$/d' -e 's/.*/          - "&"/'
}

{
  echo "# Written at start from the environment (luminous-money-gateway): edit that, not this."
  echo "entryPoints:"
  echo "  web:"
  echo '    address: ":80"'
  echo "    asDefault: true"
  echo "    forwardedHeaders:"
  echo "      trustedIPs:"
  ips
  if [ -n "$domain" ]; then
    echo "    http:"
    echo "      redirections:"
    echo "        entryPoint:"
    echo "          to: websecure"
    echo "          scheme: https"
    echo "  websecure:"
    echo '    address: ":443"'
    echo "    asDefault: true"
    echo "    forwardedHeaders:"
    echo "      trustedIPs:"
    ips
    echo "    http:"
    echo "      tls:"
    echo "        certResolver: letsencrypt"
    echo "        domains:"
    echo "          - main: \"$domain\""
  fi
  # Internal only, never published: the container's healthcheck, and the metrics app reads its
  # certificate's expiry from (/api/health).
  echo "  ping:"
  echo '    address: ":8082"'
  echo "ping:"
  echo "  entryPoint: ping"
  echo "metrics:"
  echo "  prometheus:"
  echo "    entryPoint: ping"
  if [ -n "$domain" ]; then
    echo "certificatesResolvers:"
    echo "  letsencrypt:"
    echo "    acme:"
    echo "      email: \"$LUMINOUS_MONEY_ACME_EMAIL\""
    echo "      storage: /certs/acme.json"
    echo "      httpChallenge:"
    echo "        entryPoint: web"
  fi
  echo "providers:"
  echo "  file:"
  echo "    filename: /etc/luminous-money/routes.yml"
  echo "log:"
  echo "  level: INFO"
  echo "accessLog: {}"
} > /etc/traefik/traefik.yml

exec traefik --configFile=/etc/traefik/traefik.yml "$@"
