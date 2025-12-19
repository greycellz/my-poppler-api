FROM node:18-slim

# Install system dependencies for both Poppler and Puppeteer
RUN apt-get update && apt-get install -y \
    # Existing Poppler dependency
    poppler-utils \
    # Puppeteer/Chrome dependencies
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    # Additional fonts for better rendering
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome Stable
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN npm install

# Create necessary directories for both services
RUN mkdir -p uploads output screenshots

# Copy the rest of the code (including GeoLite2-City.mmdb if it exists locally)
COPY . .

# Download GeoLite2-City database ONLY if it doesn't exist and MAXMIND_LICENSE_KEY is provided
# This is a fallback for Railway deployments where the file isn't in git
ARG MAXMIND_LICENSE_KEY
RUN if [ ! -f "./GeoLite2-City.mmdb" ] && [ -n "$MAXMIND_LICENSE_KEY" ]; then \
      echo "📥 GeoLite2-City.mmdb not found, downloading..." && \
      wget -q "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" -O /tmp/GeoLite2-City.tar.gz && \
      tar -xzf /tmp/GeoLite2-City.tar.gz -C /tmp && \
      cp /tmp/GeoLite2-City_*/GeoLite2-City.mmdb ./GeoLite2-City.mmdb && \
      rm -rf /tmp/GeoLite2-City* && \
      echo "✅ GeoLite2-City database downloaded"; \
    elif [ -f "./GeoLite2-City.mmdb" ]; then \
      echo "✅ Using existing GeoLite2-City.mmdb from build context"; \
    else \
      echo "⚠️  GeoLite2-City.mmdb not found and MAXMIND_LICENSE_KEY not provided"; \
      echo "   Geolocation will be disabled unless database is provided via MAXMIND_DB_PATH"; \
    fi

# Set Puppeteer environment variables to use system Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose port (keeping your existing 3000)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run the app
CMD ["node", "server.js"]