# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# Runtime artifacts and the modules needed for migrate + bootstrap (includes devDeps).
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src ./src
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
