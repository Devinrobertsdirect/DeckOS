FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++
RUN npm install -g pnpm@9

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all workspace packages needed by the API server
COPY lib/ ./lib/
COPY core/server/ ./core/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Push DB schema and build
WORKDIR /app/core/server
RUN pnpm run build

EXPOSE 8080
ENV NODE_ENV=production

CMD ["node", "--max-old-space-size=512", "./dist/index.mjs"]
