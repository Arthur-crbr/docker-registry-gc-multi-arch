FROM node:latest

WORKDIR /garbage-collector

COPY ./ ./

ENTRYPOINT ["node index.js"]