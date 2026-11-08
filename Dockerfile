FROM node:20-alpine

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose standard port
EXPOSE 30000

ENV NODE_ENV=production
ENV PORT=30000

CMD ["node", "src/server/server.js"]
