# devops/mock-kms/Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy server source (create server.js in same dir)
COPY server.js ./

# Install minimal runtime deps (express). Use apk helper for native build deps if any.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm init -y \
  && npm install express@4 --no-audit --no-fund \
  && apk del .build-deps

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --retries=5 CMD wget -qS --spider http://localhost:8080/ready || exit 1

CMD ["node", "server.js"]

