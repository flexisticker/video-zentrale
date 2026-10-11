# Video-Zentrale – läuft als Container auf Unraid

# Spracherkennung whisper.cpp (nur das Programm; das Modell lädt die Zentrale beim ersten Bedarf nach /data/whisper)
FROM node:22-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp /src \
 && cmake -S /src -B /src/build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
      -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /src/build -j"$(nproc)" --target whisper-cli

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
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
