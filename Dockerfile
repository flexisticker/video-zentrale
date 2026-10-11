# Video-Zentrale – läuft als Container auf Unraid
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8090 DATA_DIR=/data VIDEO_DIR=/videos TZ=Europe/Berlin
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY public ./public
# Unraid: Eintrag „WebUI“ im Container-Menü
LABEL net.unraid.docker.webui="http://[IP]:[PORT:8090]/"
EXPOSE 8090
VOLUME ["/data", "/videos"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
