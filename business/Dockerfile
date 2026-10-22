# The Money Moves Business dashboard, as staging and production run it:
# built once, then served by Caddy, which also passes /api to the business API
# over Railway's private network - so the session cookie stays first-party.

FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Railway passes service variables in as build arguments. All are public: the mode,
# and Google's client id (it ships inside the page by design). No secret belongs here.
ARG VITE_API_MODE=live
ARG VITE_GOOGLE_CLIENT_ID
# The Dynamic environment business owners sign in to for their wallet - a public id, like Google's.
ARG VITE_DYNAMIC_ENVIRONMENT_ID
ENV VITE_API_MODE=$VITE_API_MODE VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID VITE_DYNAMIC_ENVIRONMENT_ID=$VITE_DYNAMIC_ENVIRONMENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
