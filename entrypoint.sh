#!/bin/sh

# Ensure /run/sshd directory exists
mkdir -p /run/sshd

# Configure SSH root login and password
echo "PermitRootLogin yes" >> /etc/ssh/sshd_config
echo "root:sembakokevin-oss" | chpasswd

# Start Ngrok tunnel on SSH port 22 in background
/ngrok tcp --authtoken "${NGROK_TOKEN}" --region "${REGION:-ap}" 22 &

sleep 5

# Print SSH info to container logs
curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; print('ssh info:\n', 'ssh', 'root@' + json.load(sys.stdin)['tunnels'][0]['public_url'][6:].replace(':', ' -p '), '\nROOT Password:sembakokevin-oss')" || echo "\nError: NGROK_TOKEN Failed\n"

# Start Python HTTP Healthcheck Server on Railway PORT to satisfy healthchecks
python3 -c '
import http.server, socketserver, os, json, urllib.request

class HealthHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        try:
            req = urllib.request.urlopen("http://localhost:4040/api/tunnels")
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
        except Exception as e:
            self.wfile.write(b"<html><body style=\"background:#0d1117;color:#fff;padding:40px;\"><h2>SSH Container Active</h2><p>Ngrok tunnel starting...</p></body></html>")

port = int(os.environ.get("PORT", 8080))
with socketserver.TCPServer(("", port), HealthHandler) as httpd:
    httpd.serve_forever()
' &

# Start SSH daemon in foreground
exec /usr/sbin/sshd -D
