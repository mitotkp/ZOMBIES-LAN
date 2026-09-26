FROM node:22-alpine
WORKDIR /app

# node_modules (three, ws) ya viene commiteado en el repo: no hace falta npm install/ci.
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
