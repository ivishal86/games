FROM node:18-alpine

WORKDIR /src

RUN apk add --no-cache curl bash && \
    curl -fsSL https://bun.sh/install | bash && \
    mv /root/.bun/bin/bun /usr/local/bin/bun

COPY package*.json ./
RUN npm install
COPY . .

CMD ["npm", "start"]