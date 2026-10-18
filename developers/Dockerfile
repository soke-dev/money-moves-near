# The developer docs, docs.usemoneymoves.xyz: a static site, built once and served by Caddy.
# No variables and no secrets: every page is in src/pages.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
