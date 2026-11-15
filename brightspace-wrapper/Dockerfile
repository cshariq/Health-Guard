# Lumen website — runs the zero-dependency Node server (works on Fly, Railway, Cloud Run, etc.)
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "web/server.mjs"]
