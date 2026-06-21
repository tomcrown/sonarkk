FROM node:20-alpine

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

# Generate Prisma client (platform-specific binary for Linux/Alpine)
RUN cd packages/core && npx prisma generate

# Build packages that the API imports from
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/backtest

# Build the API itself
RUN npm run build --workspace=packages/api

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "packages/api/dist/index.js"]
