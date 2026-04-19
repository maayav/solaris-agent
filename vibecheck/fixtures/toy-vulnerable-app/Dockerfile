FROM node:18-slim

USER root

RUN mkdir -p /app && chmod 777 /app

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN chmod -R 777 /app

EXPOSE 3000

CMD ["node", "src/app.js"]
