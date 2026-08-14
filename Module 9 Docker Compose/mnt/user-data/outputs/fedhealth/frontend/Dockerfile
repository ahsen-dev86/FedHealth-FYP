# frontend/Dockerfile
# Build context = ./frontend
# Multi-stage: build the Vite SPA, then serve the static bundle with nginx which
# also reverse-proxies /api -> the backend (so the SPA and API share an origin).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
