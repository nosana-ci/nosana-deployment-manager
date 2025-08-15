# Build stage
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# Production stage
FROM node:20-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
ARG SKIP_FETCH_RDS_BUNDLE=false
RUN if [ "$SKIP_FETCH_RDS_BUNDLE" != "true" ]; then \
    node -e "const https=require('https'),fs=require('fs'); \
    https.get('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', \
    res=>res.pipe(fs.createWriteStream('global-bundle.pem')))"; \
  fi
CMD ["node", "dist/src/index.js"]