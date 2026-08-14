# backend/Dockerfile
# Build context = ./backend
#   (built by the root docker-compose.yml)
FROM node:22-slim

WORKDIR /app

# Tesseract OCR binary — required by the /ocr route (node-tesseract-ocr shells
# out to it). eng language data is included with the package.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr \
 && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). All deps are pure-JS / prebuilt, so
# no build toolchain is needed.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production PORT=4000
EXPOSE 4000

# Healthcheck via Node's global fetch (Node 22) — no curl needed in the image.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
