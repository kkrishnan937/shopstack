FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run as non-root - basic container security hygiene, also what Trivy/kube-bench
# style scanners check for.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8080
CMD ["node", "server.js"]
