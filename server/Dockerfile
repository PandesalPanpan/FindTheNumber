# --- build stage: compile TypeScript to JS ---
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# --- runtime stage: only production deps + compiled output ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY server/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8787
# lightweight container healthcheck against the /health route
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1
CMD ["node", "dist/index.js"]
