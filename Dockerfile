# --- deps: install full dependency tree (dev deps included — needed to build and to run `prisma migrate deploy` at startup) ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# --- build: generate the Prisma client and compile TypeScript ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts reads DATABASE_URL at load time even for `generate`,
# which needs no live DB connection — a placeholder value is enough.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN yarn prisma:generate
RUN yarn build

# --- webapp: собрать Mini App (Vue) в статику, её раздаёт Nest (src/main.ts) ---
FROM node:22-alpine AS webapp
WORKDIR /webapp
COPY webapp/package.json webapp/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY webapp ./
RUN yarn build

# --- runtime: run pending migrations, then start the compiled app ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
# from `build`, not `deps` — only `build` ran `prisma generate`, which writes the
# generated client into node_modules (.prisma/client, @prisma/client/default.js)
# --chown сразу при копировании: отдельный `chown -R` по node_modules копирует каждый файл в новый
# слой — сборка висит минутами, а образ раздувается вдвое.
COPY --chown=app:app --from=build /app/node_modules ./node_modules
COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app --from=webapp /webapp/dist ./public
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app prisma.config.ts package.json ./
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER app
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
