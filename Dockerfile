FROM node:18-slim

# Install Poppler-utils
RUN apt-get update && apt-get install -y poppler-utils && apt-get clean

# Set working directory
WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Run the app
CMD ["node", "server.js"]
