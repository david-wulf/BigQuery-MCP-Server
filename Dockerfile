# Optional: stdio-Server ueber supergateway als SSE-Dienst auf Port 8000.
# Das Dienstkonto kommt als JSON in BIGQUERY_SERVICE_ACCOUNT_JSON und wird beim Start
# nach /tmp geschrieben - die Datei liegt nur im laufenden Container.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && npm install -g supergateway@4.1.0
ENV BIGQUERY_KEY_FILE=/tmp/bigquery-key.json
EXPOSE 8000
CMD ["sh", "-c", "umask 077 && printf '%s' \"$BIGQUERY_SERVICE_ACCOUNT_JSON\" > /tmp/bigquery-key.json && exec supergateway --stdio 'node /app/dist/index.js' --port 8000"]
