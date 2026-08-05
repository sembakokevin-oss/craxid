FROM debian:latest

ARG NGROK_TOKEN=3HTO4awV1SUNUc7ItK0EefZOR0i_5p25sycyjdeDMxJ1EVP5J
ARG REGION=ap

ENV NGROK_TOKEN=${NGROK_TOKEN}
ENV REGION=${REGION}
ENV DEBIAN_FRONTEND=noninteractive

# Update apt dan install paket yang dibutuhkan
RUN apt update && apt upgrade -y && apt install -y \
    openssh-server wget unzip vim curl python3 \
    && rm -rf /var/lib/apt/lists/*

# Download dan ekstrak Ngrok
RUN wget -q https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip -O /ngrok-stable-linux-amd64.zip \
    && cd / && unzip ngrok-stable-linux-amd64.zip \
    && chmod +x ngrok \
    && rm /ngrok-stable-linux-amd64.zip

# Copy script entrypoint dan beri izin eksekusi
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose ports yang diperlukan
EXPOSE 22 80 443 3306 4040 5432 5700 5701 5010 6800 6900 8080 8888 9000

CMD ["/entrypoint.sh"]