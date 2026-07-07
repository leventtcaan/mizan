# WHY: node:20-alpine is ~170 MB vs node:20 at ~1 GB. Alpine is fine for Next.js.
FROM node:20-alpine

WORKDIR /app

# WHY: Copy package files first so Docker caches npm install separately from source code.
# Source changes won't re-run npm install unless package.json changes — big time saver.
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# WHY: next dev --hostname 0.0.0.0 binds to all interfaces inside the container.
# Without this, Next.js binds to 127.0.0.1 only and Docker port mapping can't reach it.
RUN npm run build
CMD ["npm", "start"]
