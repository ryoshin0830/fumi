FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    age chromium fonts-noto-cjk gnupg pinentry-curses openssh-client python3-pexpect \
    xclip xvfb xauth zsh \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV DISPLAY=:99 TERM=xterm NEXT_TELEMETRY_DISABLED=1
CMD ["node", "scripts/e2e/container.mjs"]
