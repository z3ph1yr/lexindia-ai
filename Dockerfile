# LexIndia AI — single-container production image (UI + API + knowledge base)
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json* server/
COPY web/package.json web/package-lock.json* web/
RUN npm --prefix server ci --no-fund --no-audit
RUN npm --prefix web ci --no-fund --no-audit
COPY server/ server/
COPY web/ web/
# Build the knowledge base from the committed offline caches, then the UI.
RUN node server/src/ingest/pipeline.js --skip-network
RUN npm --prefix web run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server /app/server
COPY --from=build /app/web/dist /app/web/dist
COPY --from=build /app/data /app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8787/api/health || exit 1
CMD ["node", "server/src/index.js"]
