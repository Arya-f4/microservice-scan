# Gunakan image Node.js sebagai base image
FROM node:lts-alpine

# Tentukan direktori kerja di dalam container
WORKDIR /app

# Salin package.json dan package-lock.json ke direktori kerja
COPY package.json /app

# Install dependencies
RUN npm install

# Salin seluruh kode aplikasi ke direktori kerja
COPY . /app

# Instalasi Nuclei
RUN apt-get update && \
    apt-get install -y wget && \
    wget https://github.com/projectdiscovery/nuclei/releases/download/v3.3.0/nuclei_3.3.0_linux_amd64.zip && \
    unzip nuclei_3.3.0_linux_amd64.zip && \
    mv nuclei /usr/local/bin/ && \
    rm nuclei_3.3.0_linux_amd64.zip

# Expose port yang digunakan aplikasi
EXPOSE 3000

# Perintah untuk menjalankan aplikasi
CMD ["npm", "start"]
