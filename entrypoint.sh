#!/bin/sh

# Ensure /run/sshd directory exists
mkdir -p /run/sshd

# Configure SSHD to listen on port 2222 internally (so PORT=22 can be used by HTTP healthcheck)
echo "Port 2222" >> /etc/ssh/sshd_config
echo "PermitRootLogin yes" >> /etc/ssh/sshd_config
echo "root:sembakokevin-oss" | chpasswd

# Start Python HTTP Healthcheck Server IMMEDIATELY on $PORT (handles PORT=22 or PORT=8080)
python3 -c '
import http.server, socketserver, os, json, urllib.request

class HealthHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        try:
            req = urllib.request.urlopen("http://localhost:4040/api/tunnels", timeout=2)
            data = json.loads(req.read().decode())
            pub_url = data["tunnels"][0]["public_url"]
            ssh_cmd = "ssh root@" + pub_url[6:].replace(":", " -p ")
            r_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "ngrok-production-ff12.up.railway.app")
            html = f"""<html>
<head>
  <title>SSH Container Status - Railway</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; padding: 40px; background: #0d1117; color: #c9d1d9; max-width: 650px; margin: auto;">
  <h2 style="color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px;">🚀 SSH Container Active</h2>
  <p><b>Domain:</b> <a href="https://{r_domain}" style="color: #58a6ff;">https://{r_domain}</a></p>
  <p><b>SSH Command:</b></p>
  <pre style="background: #161b22; padding: 12px; border-radius: 6px; border: 1px solid #30363d; color: #79c0ff; font-size: 14px; overflow-x: auto;">{ssh_cmd}</pre>
  <p><b>ROOT Password:</b> <code style="background: #21262d; padding: 4px 8px; border-radius: 4px; color: #ffa657;">sembakokevin-oss</code></p>
  <hr style="border: 0; border-top: 1px solid #30363d; margin-top: 20px;">
  <p style="font-size: 12px; color: #8b949e;">Status: Healthy | Service: {os.environ.get("RAILWAY_SERVICE_NAME", "Ngrok")} | Env: {os.environ.get("RAILWAY_ENVIRONMENT_NAME", "production")}</p>
</body>
</html>"""
            self.wfile.write(html.encode())
        except Exception:
            self.wfile.write(b"<html><body style=\"background:#0d1117;color:#fff;padding:40px;\"><h2>SSH Container Active</h2><p>Healthcheck OK - Ngrok starting...</p></body></html>")

    def log_message(self, format, *args):
        return

port_str = os.environ.get("PORT", "8080")
try:
    port = int(port_str)
except ValueError:
    port = 8080

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", port), HealthHandler) as httpd:
    httpd.serve_forever()
' &

# Start Ngrok tunnel on internal SSH port 2222 in background
/ngrok tcp --authtoken "${NGROK_TOKEN}" --region "${REGION:-ap}" 2222 &

sleep 3

# Print SSH info to container logs
curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; print('ssh info:\n', 'ssh', 'root@' + json.load(sys.stdin)['tunnels'][0]['public_url'][6:].replace(':', ' -p '), '\nROOT Password:sembakokevin-oss')" 2>/dev/null || echo "Ngrok tunnel initializing..."

# Start SSH daemon in foreground
exec /usr/sbin/sshd -D
