FROM node:20-alpine

# Prisma query engine (linux-musl-openssl-3.0.x) requires libssl
RUN apk add --no-cache openssl

WORKDIR /app

# Copy manifests first (layer-cached until deps change)
COPY package.json package-lock.json ./
COPY packages/core/package.json       ./packages/core/
COPY packages/api/package.json        ./packages/api/
COPY packages/backtest/package.json   ./packages/backtest/
COPY packages/keeper/package.json     ./packages/keeper/

# Install all workspace deps (including devDeps — needed for tsc + prisma)
RUN npm ci

# Copy source
COPY tsconfig.base.json ./
COPY packages/core/prisma      ./packages/core/prisma
COPY packages/core/src         ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/backtest/src     ./packages/backtest/src
COPY packages/backtest/tsconfig.json ./packages/backtest/
COPY packages/api/src          ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/keeper/src       ./packages/keeper/src
COPY packages/keeper/tsconfig.json ./packages/keeper/

# Generate Prisma client (platform-specific binary for Linux/Alpine)
RUN cd packages/core && npx prisma generate

# Build all packages
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/backtest
RUN npm run build --workspace=packages/api
RUN npm run build --workspace=packages/keeper

EXPOSE 3001
ENV NODE_ENV=production

# Default: API server.
# For the keeper service, override this in Railway with:
#   node packages/keeper/dist/index.js
CMD ["node", "packages/api/dist/index.js"]
