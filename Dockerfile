FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV PORT=3000 DB_FILE=/data/data.sqlite
EXPOSE 3000
CMD ["node", "server/index.ts"]
