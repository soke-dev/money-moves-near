# Kòkó Coffee, the demo shop: Node only, no dependencies.
# Set MONEYMOVES_SECRET_KEY and MONEYMOVES_WEBHOOK_SECRET on the service. Nothing secret goes in the image.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
