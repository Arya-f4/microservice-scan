# Use Node.js image as base image
FROM node:22

# Set working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to working directory
COPY package.json package-lock.json /app/

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . /app

# Install Nuclei
RUN apt-get update && \
    apt-get install -y wget unzip && \
    wget https://github.com/projectdiscovery/nuclei/releases/download/v3.3.0/nuclei_3.3.0_linux_amd64.zip && \
    unzip nuclei_3.3.0_linux_amd64.zip && \
    mv nuclei /usr/local/bin/ && \
    rm nuclei_3.3.0_linux_amd64.zip

# Create directory for Nuclei templates
RUN mkdir -p /root/nuclei-templates

# Download and install Nuclei templates
RUN nuclei -update-templates -t /root/nuclei-templates

# Tambahkan Ruby
RUN apt-get install -y ruby ruby-dev build-essential

# Install wpscan
RUN gem install wpscan

# Set environment variable for Nuclei templates path
ENV NUCLEI_TEMPLATES=/root/nuclei-templates

# Expose the port used by the application
EXPOSE 9020

# Command to run the application
CMD ["npm", "start"]
