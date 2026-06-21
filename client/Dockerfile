# --- build stage: build the Vite SPA (needs the workspace + shared core) ---
FROM node:20-alpine AS build
WORKDIR /app
# install deps using the workspace manifests (better layer caching)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm install
# bring in the sources actually needed to build the client
COPY tsconfig.base.json ./
COPY shared ./shared
COPY client ./client
# Leave empty for same-origin /ws (recommended with the nginx proxy below).
# Override only if the signaling server lives on a different origin.
ARG VITE_SIGNAL_URL=""
ENV VITE_SIGNAL_URL=$VITE_SIGNAL_URL
RUN npm -w client run build

# --- runtime stage: nginx serves static files + proxies /ws ---
FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
