# syntax=docker/dockerfile:1
FROM node:24-alpine AS build-env
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS production-dependencies-env
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/build ./build
ENV HOST=0.0.0.0 NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/sGxOxDs/Image-Playground"
EXPOSE 3000
USER node
CMD ["node", "./node_modules/@react-router/serve/bin.cjs", "./build/server/index.js"]
