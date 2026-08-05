const http = require('http');

let PORT = parseInt(process.env.PORT || '8080', 10);
if (PORT === 5432) {
  PORT = 8080;
}

const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || 'craxid-production.up.railway.app';
const RAILWAY_TCP_PROXY_DOMAIN = process.env.RAILWAY_TCP_PROXY_DOMAIN || 'zephyr.proxy.rlwy.net';
const RAILWAY_TCP_PROXY_PORT = process.env.RAILWAY_TCP_PROXY_PORT || '41183';
const RAILWAY_SERVICE_NAME = process.env.RAILWAY_SERVICE_NAME || 'craxid';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  let ngrokSshCmd = '';
  const options = {
    hostname: '127.0.0.1',
    port: 4040,
    path: '/api/tunnels',
    method: 'GET',
    timeout: 1000
  };

  const getNgrokInfo = new Promise((resolve) => {
    const ngReq = http.request(options, (ngRes) => {
      let data = '';
      ngRes.on('data', (chunk) => { data += chunk; });
      ngRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.tunnels && parsed.tunnels.length > 0) {
            const pubUrl = parsed.tunnels[0].public_url;
            ngrokSshCmd = 'ssh root@' + pubUrl.substring(6).replace(':', ' -p ');
          }
        } catch (e) {}
        resolve();
      });
    });

    ngReq.on('error', () => resolve());
    ngReq.on('timeout', () => {
      ngReq.destroy();
      resolve();
    });
    ngReq.end();
  });

  getNgrokInfo.then(() => {
    const railwaySshCmd = `ssh root@${RAILWAY_TCP_PROXY_DOMAIN} -p ${RAILWAY_TCP_PROXY_PORT}`;

    const ngrokBlock = ngrokSshCmd ? `
    <div class="section-title">Ngrok Tunnel SSH Command</div>
    <div class="cmd-box">
      <span class="cmd-text" id="ngrokCmd">${ngrokSshCmd}</span>
      <button class="btn-copy" onclick="copyText('ngrokCmd', this)">Copy Ngrok SSH</button>
    </div>` : '';

    const railwayBlock = railwaySshCmd ? `
    <div class="section-title">Railway Direct SSH Command</div>
    <div class="cmd-box">
      <span class="cmd-text" id="railwayCmd">${railwaySshCmd}</span>
      <button class="btn-copy" onclick="copyText('railwayCmd', this)">Copy Direct SSH</button>
    </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VPS Control Center - craxid</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .card {
      background: rgba(22, 27, 34, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(48, 54, 61, 0.8);
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 680px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #21262d;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      background: linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(46, 160, 67, 0.15);
      color: #3fb950;
      border: 1px solid rgba(46, 160, 67, 0.4);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .pulse {
      width: 8px;
      height: 8px;
      background: #3fb950;
      border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
      animation: pulse 1.6s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(63, 185, 80, 0); }
      100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #8b949e;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .cmd-box {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }
    .cmd-text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      color: #79c0ff;
      font-size: 14px;
      word-break: break-all;
    }
    .btn-copy {
      background: #238636;
      color: #ffffff;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      margin-left: 12px;
    }
    .btn-copy:hover {
      background: #2ea043;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 24px;
    }
    .grid-item {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 10px;
      padding: 14px;
    }
    .val {
      font-size: 14px;
      font-weight: 600;
      color: #f0f6fc;
      margin-top: 4px;
      font-family: monospace;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #8b949e;
      border-top: 1px solid #21262d;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">⚡ VPS Container Dashboard</div>
      <div class="badge"><div class="pulse"></div>ONLINE</div>
    </div>

    ${railwayBlock}
    ${ngrokBlock}

    <div class="grid">
      <div class="grid-item">
        <div class="section-title">SSH User</div>
        <div class="val" style="color: #58a6ff;">root</div>
      </div>
      <div class="grid-item">
        <div class="section-title">SSH Password</div>
        <div class="val" style="color: #ffa657;">sembakokevin-oss</div>
      </div>
      <div class="grid-item">
        <div class="section-title">Railway TCP Host</div>
        <div class="val">${RAILWAY_TCP_PROXY_DOMAIN}</div>
      </div>
      <div class="grid-item">
        <div class="section-title">Railway TCP Port</div>
        <div class="val" style="color: #79c0ff;">${RAILWAY_TCP_PROXY_PORT}</div>
      </div>
    </div>

    <div class="footer">
      Domain: <b><a href="https://${RAILWAY_PUBLIC_DOMAIN}" style="color: #58a6ff;">${RAILWAY_PUBLIC_DOMAIN}</a></b> • Service: <b>${RAILWAY_SERVICE_NAME}</b> • Runtime: <b>Node.js</b>
    </div>
  </div>

  <script>
    function copyText(elementId, btn) {
      const txt = document.getElementById(elementId).innerText;
      navigator.clipboard.writeText(txt).then(() => {
        const oldText = btn.innerText;
        btn.innerText = 'Copied! ✓';
        btn.style.background = '#1f6feb';
        setTimeout(() => {
          btn.innerText = oldText;
          btn.style.background = '#238636';
        }, 2000);
      });
    }
  </script>
</body>
</html>`;

    res.end(html);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} in use. Switching to port 8080...`);
    PORT = 8080;
    setTimeout(() => {
      server.close();
      server.listen(8080, '0.0.0.0');
    }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Node.js HTTP Server listening on 0.0.0.0:${PORT}`);
});
