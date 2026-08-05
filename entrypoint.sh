#!/bin/sh

# Ensure /run/sshd directory exists
mkdir -p /run/sshd

# Configure SSHD to listen on port 2222 internally
echo "Port 2222" >> /etc/ssh/sshd_config
echo "PermitRootLogin yes" >> /etc/ssh/sshd_config
echo "root:sembakokevin-oss" | chpasswd

# Start Python HTTP Healthcheck Server IMMEDIATELY on $PORT in background
python3 /server.py &

# Configure Ngrok authtoken
/ngrok config add-authtoken "${NGROK_TOKEN:-3HTO4awV1SUNUc7ItK0EefZOR0i_5p25sycyjdeDMxJ1EVP5J}" >/dev/null 2>&1

# Start Ngrok tunnel on internal port 2222 and log to /tmp/ngrok.log
/ngrok tcp --region "${REGION:-ap}" 2222 > /tmp/ngrok.log 2>&1 &

# Start SSH daemon in foreground
exec /usr/sbin/sshd -D
