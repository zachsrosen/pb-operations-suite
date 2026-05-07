FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile

# Certs mounted at runtime via Fly volume (fly.toml [mounts])
# Do NOT bake certs into the image.

EXPOSE 8443
