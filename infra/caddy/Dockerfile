# Caddy with one extra module: rate limiting at the door (github.com/mholt/caddy-ratelimit, by Caddy's author).
# Stock Caddy has no rate limiter. Both the server and the module are pinned: a tag of an image can be moved and a
# module's "latest" changes, a version and a commit cannot.
FROM caddy:2.11.9-builder-alpine AS build
RUN xcaddy build v2.11.9 \
    --with github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM caddy:2.11.9-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
