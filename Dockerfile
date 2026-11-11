# Game multiplayer server. No npm packages: just Node and the game's own files.
FROM node:22-alpine

WORKDIR /app
COPY package.json index.html ./
COPY src ./src
COPY server ./server

# The world and everyone's progress are saved here; mount a volume to keep them.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

ENV HOST=0.0.0.0 PORT=8000 DATA_DIR=/data
EXPOSE 8000
USER node
CMD ["node", "server/index.js"]
