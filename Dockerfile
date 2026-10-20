FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=8787 DB_PATH=/data/studio.db
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server.js"]
