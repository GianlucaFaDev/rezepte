FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /root/.npm
COPY server.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
