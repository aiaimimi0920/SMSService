FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY repos/EasySMS/package*.json ./
RUN npm ci

COPY repos/EasySMS/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="easy-sms-service"
LABEL org.opencontainers.image.description="Unified SMS aggregation runtime with provider health management and public inbox abstraction."
LABEL org.opencontainers.image.source="https://github.com/aiaimimi0920/EasySMS"
LABEL org.opencontainers.image.url="https://github.com/aiaimimi0920/EasySMS"
LABEL org.opencontainers.image.documentation="https://github.com/aiaimimi0920/SMSService/tree/main/deploy/EasySMS"

ENV NODE_ENV=production
ENV EASY_SMS_CONFIG_PATH=/etc/easy-sms/config.yaml
ENV EASY_SMS_STATE_DIR=/var/lib/easy-sms
ENV EASY_SMS_RESET_STORE_ON_BOOT=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY repos/EasySMS/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY deploy/EasySMS/docker-entrypoint.sh /usr/local/bin/easy-sms-entrypoint.sh
COPY deploy/EasySMS/config.template.yaml /opt/easy-sms/config.template.yaml

RUN chmod +x /usr/local/bin/easy-sms-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/easy-sms-entrypoint.sh"]
CMD ["node", "dist/src/runtime/main.js"]
