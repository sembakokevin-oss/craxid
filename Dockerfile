FROM debian
ARG NGROK_TOKEN
ARG REGION=ap
ENV DEBIAN_FRONTEND=noninteractive

# Update apt dan install paket yang dibutuhkan (termasuk openssh-server)
RUN apt update && apt upgrade -y && apt install -y \
    openssh-server wget unzip vim curl python3

# Download dan ekstrak Ngrok
RUN wget -q https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip -O /ngrok-stable-linux-amd64.zip \
    && cd / && unzip ngrok-stable-linux-amd64.zip \
    && chmod +x ngrok

# Konfigurasi SSH dan buat script startup
RUN mkdir /run/sshd \
    && echo "/ngrok tcp --authtoken \${NGROK_TOKEN} --region \${REGION} 22 &" >> /openssh.sh \
    && echo "sleep 5" >> /openssh.sh \
    && echo "curl -s http://localhost:4040/api/tunnels | python3 -c \"import sys, json; print('ssh info:\\n', 'ssh', 'root@' + json.load(sys.stdin)['tunnels'][0]['public_url'][6:].replace(':', ' -p '), '\\nROOT Password:craxid')\" || echo \"\nError: NGROK_TOKEN Failed\n\"" >> /openssh.sh \
    && echo '/usr/sbin/sshd -D' >> /openssh.sh \
    && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
    && echo 'root:craxid' | chpasswd \
    && chmod 755 /openssh.sh

# Expose ports yang diperlukan
EXPOSE 22 80 443 3306 4040 5432 5700 5701 5010 6800 6900 8080 8888 9000

CMD /openssh.sh
