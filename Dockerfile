# ── LP_MD WhatsApp Bot ──────────────────────────
FROM node:20

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Create session directory
RUN mkdir -p session

# Expose port for pairing site
EXPOSE 3000

# Start bot
CMD ["node", "index.js"]
