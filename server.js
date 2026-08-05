const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

let PORT = parseInt(process.env.PORT || '8080', 10);
if (PORT === 5432) {
  PORT = 8080;
}

const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || 'craxid-production.up.railway.app';
const RAILWAY_TCP_PROXY_DOMAIN = process.env.RAILWAY_TCP_PROXY_DOMAIN || 'zephyr.proxy.rlwy.net';
const RAILWAY_TCP_PROXY_PORT = process.env.RAILWAY_TCP_PROXY_PORT || '41183';
const RAILWAY_SERVICE_NAME = process.env.RAILWAY_SERVICE_NAME || 'craxid';

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // --- API: EXECUTE SHELL COMMAND WITH REAL TTY COLUMN FORMATTING ---
  if (req.method === 'POST' && pathname === '/api/exec') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        let rawCmd = (data.command || 'pwd').trim();
        let cwd = data.cwd && fs.existsSync(data.cwd) ? data.cwd : '/';
        
        if (rawCmd.startsWith('cd ')) {
          const targetDir = rawCmd.substring(3).trim();
          const resolvedPath = path.resolve(cwd, targetDir);
          if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            cwd = resolvedPath;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              stdout: `Changed directory to: ${cwd}\n`,
              stderr: '',
              code: 0,
              cwd: cwd
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              stdout: '',
              stderr: `bash: cd: ${targetDir}: No such file or directory\n`,
              code: 1,
              cwd: cwd
            }));
          }
        } else if (rawCmd === 'cd') {
          cwd = '/root';
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            stdout: `Changed directory to: /root\n`,
            stderr: '',
            code: 0,
            cwd: '/root'
          }));
        }

        // If user runs plain 'ls' or 'ls <path>', add column flag '-C' for multi-column horizontal display
        if (rawCmd === 'ls') {
          rawCmd = 'ls -C';
        } else if (rawCmd.startsWith('ls ') && !rawCmd.includes('-1') && !rawCmd.includes('-l') && !rawCmd.includes('-C')) {
          rawCmd = rawCmd.replace(/^ls\s+/, 'ls -C ');
        }

        // Pass COLUMNS=110 environment variable so Linux CLI formats columns horizontally
        const customEnv = Object.assign({}, process.env, {
          COLUMNS: '110',
          LINES: '30',
          TERM: 'xterm-256color'
        });

        exec(rawCmd, { cwd, env: customEnv, maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            code: error ? (error.code || 1) : 0,
            cwd: cwd
          }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- API: READ FILE CONTENT ---
  if (req.method === 'GET' && pathname === '/api/readfile') {
    const filePath = urlObj.searchParams.get('path');
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }

    try {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cannot edit a directory' }));
      }

      if (stats.size > 5 * 1024 * 1024) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'File is too large to edit via web editor (> 5MB)' }));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        path: filePath,
        name: path.basename(filePath),
        content: content
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- API: SAVE FILE CONTENT ---
  if (req.method === 'POST' && pathname === '/api/savefile') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const filePath = data.path;
        const content = data.content;

        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid file path' }));
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, path: filePath }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- API: LIST FILES IN DIRECTORY ---
  if (req.method === 'GET' && pathname === '/api/files') {
    let targetPath = urlObj.searchParams.get('path') || '/';
    if (!fs.existsSync(targetPath)) targetPath = '/';

    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not a directory' }));
      }

      const items = fs.readdirSync(targetPath).map(name => {
        const fullPath = path.join(targetPath, name);
        try {
          const s = fs.statSync(fullPath);
          return {
            name,
            path: fullPath,
            isDir: s.isDirectory(),
            size: s.size,
            mtime: s.mtime
          };
        } catch (e) {
          return { name, path: fullPath, isDir: false, size: 0, mtime: new Date() };
        }
      });

      items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ path: targetPath, items }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- API: UPLOAD FILE ---
  if (req.method === 'POST' && pathname === '/api/upload') {
    const targetDir = urlObj.searchParams.get('dir') || '/root';
    const filename = urlObj.searchParams.get('filename') || `file_${Date.now()}`;
    const destFolder = fs.existsSync(targetDir) ? targetDir : '/root';
    const targetPath = path.join(destFolder, path.basename(filename));

    const writeStream = fs.createWriteStream(targetPath);
    req.pipe(writeStream);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, path: targetPath, filename, dir: destFolder }));
    });
    req.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // --- API: DELETE FILE / FOLDER ---
  if (req.method === 'POST' && pathname === '/api/delete') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (data.path && fs.existsSync(data.path)) {
          fs.rmSync(data.path, { recursive: true, force: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File or folder not found' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- API: CREATE DIRECTORY ---
  if (req.method === 'POST' && pathname === '/api/mkdir') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const targetDir = data.dir || '/root';
        const folderName = data.name || 'new_folder';
        const fullPath = path.join(targetDir, folderName);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: fullPath }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- HTML MAIN DASHBOARD PAGE ---
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    const hostname = os.hostname();
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
        ngRes.on('data', chunk => data += chunk);
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
      ngReq.on('timeout', () => { ngReq.destroy(); resolve(); });
      ngReq.end();
    });

    getNgrokInfo.then(() => {
      const railwaySshCmd = `ssh root@${RAILWAY_TCP_PROXY_DOMAIN} -p ${RAILWAY_TCP_PROXY_PORT}`;

      const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Console Root - VPS Control Center</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }

    .page-screen { display: none; width: 100%; max-width: 920px; }
    .page-screen.active { display: block; }

    .card {
      background: rgba(22, 27, 34, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(48, 54, 61, 0.8);
      border-radius: 16px;
      padding: 28px;
      width: 100%;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      margin-bottom: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #21262d;
      flex-wrap: wrap;
      gap: 12px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      background: linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge-root {
      background: rgba(188, 140, 255, 0.15);
      color: #bc8cff;
      border: 1px solid rgba(188, 140, 255, 0.4);
      padding: 4px 10px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-status {
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
    .btn-refresh {
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-refresh:hover { background: #30363d; color: #fff; }
    .spin-icon { display: inline-block; transition: transform 0.6s ease; }
    .spinning { animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* SSH Command boxes */
    .cmd-section { margin-bottom: 20px; }
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
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
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
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      margin-left: 12px;
    }
    .btn-copy:hover { background: #2ea043; }

    /* Grid Items */
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
    .val-box {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 4px;
    }
    .val {
      font-size: 14px;
      font-weight: 600;
      color: #f0f6fc;
      font-family: monospace;
    }
    .btn-copy-sm {
      background: rgba(88, 166, 255, 0.15);
      color: #58a6ff;
      border: 1px solid rgba(88, 166, 255, 0.4);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-copy-sm:hover { background: #1f6feb; color: #fff; }

    /* Page Navigation Buttons */
    .btn-nav-page2 {
      background: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);
      color: #ffffff;
      border: none;
      padding: 14px 28px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 15px rgba(31, 111, 235, 0.4);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-nav-page2:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(31, 111, 235, 0.6);
    }
    .btn-back {
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-back:hover { background: #30363d; color: #fff; }

    /* Tabs Navigation inside Page 2 */
    .tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #21262d;
      margin-bottom: 20px;
      padding-bottom: 4px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: #8b949e;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: #c9d1d9; background: rgba(110, 118, 129, 0.1); }
    .tab-btn.active { color: #58a6ff; background: rgba(88, 166, 255, 0.15); border-bottom: 2px solid #58a6ff; }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Terminal Console Precision Grid Layout */
    .terminal-window {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      overflow: hidden;
    }
    .terminal-header {
      background: #161b22;
      padding: 10px 16px;
      font-size: 12px;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .terminal-output {
      padding: 16px;
      min-height: 260px;
      max-height: 440px;
      overflow-x: auto;
      overflow-y: auto;
      font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.4;
      color: #c9d1d9;
      white-space: pre;
    }
    .terminal-input-bar {
      display: flex;
      background: #161b22;
      border-top: 1px solid #21262d;
      padding: 8px 12px;
      align-items: center;
      gap: 10px;
    }
    .prompt-label {
      color: #3fb950;
      font-family: monospace;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .term-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #58a6ff;
      font-family: monospace;
      font-size: 14px;
      outline: none;
    }
    .btn-exec {
      background: #1f6feb;
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-exec:hover { background: #388bfd; }
    .quick-cmds {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .btn-chip {
      background: #161b22;
      border: 1px solid #30363d;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-family: monospace;
      cursor: pointer;
    }
    .btn-chip:hover { color: #58a6ff; border-color: #58a6ff; }

    /* File Manager */
    .fm-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .path-display {
      font-family: monospace;
      font-size: 13px;
      color: #58a6ff;
      background: #0d1117;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid #30363d;
      flex: 1;
    }
    .fm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .table-container {
      border: 1px solid #30363d;
      border-radius: 10px;
      overflow: hidden;
      background: #0d1117;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: #161b22; padding: 12px 16px; color: #8b949e; font-weight: 600; border-bottom: 1px solid #21262d; }
    td { padding: 12px 16px; border-bottom: 1px solid #21262d; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(110, 118, 129, 0.05); }
    .item-name { display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; color: #f0f6fc; }
    .item-name:hover { color: #58a6ff; }

    .btn-action-sm {
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      margin-right: 4px;
    }
    .btn-edit { background: rgba(88, 166, 255, 0.15); color: #58a6ff; border-color: rgba(88, 166, 255, 0.4); }
    .btn-edit:hover { background: #1f6feb; color: #fff; }
    .btn-del { background: rgba(248, 81, 73, 0.15); color: #f85149; border-color: rgba(248, 81, 73, 0.4); }
    .btn-del:hover { background: #f85149; color: #fff; }

    /* Code Editor Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      padding: 20px;
    }
    .modal-overlay.active { display: flex; }
    .modal-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 14px;
      width: 100%;
      max-width: 900px;
      height: 85vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8);
    }
    .modal-header {
      background: #0d1117;
      padding: 14px 20px;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-title {
      font-family: monospace;
      font-size: 14px;
      color: #79c0ff;
      font-weight: 700;
    }
    .modal-close {
      background: transparent;
      border: none;
      color: #8b949e;
      font-size: 18px;
      cursor: pointer;
      font-weight: bold;
    }
    .modal-close:hover { color: #f85149; }
    .editor-body {
      flex: 1;
      padding: 16px;
      background: #0d1117;
      display: flex;
      flex-direction: column;
    }
    .code-textarea {
      flex: 1;
      width: 100%;
      background: #090d16;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      resize: none;
      outline: none;
      tab-size: 2;
    }
    .code-textarea:focus { border-color: #58a6ff; }
    .modal-footer {
      background: #161b22;
      padding: 12px 20px;
      border-top: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn-save-file {
      background: #238636;
      color: #fff;
      border: none;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-save-file:hover { background: #2ea043; }
    .save-status { font-size: 13px; color: #3fb950; display: none; font-weight: 600; }

    /* Upload Area */
    .drop-zone {
      border: 2px dashed #30363d;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      background: #0d1117;
      cursor: pointer;
      transition: all 0.2s;
    }
    .drop-zone:hover, .drop-zone.dragover { border-color: #58a6ff; background: rgba(88, 166, 255, 0.05); }
    .drop-icon { font-size: 36px; margin-bottom: 12px; display: block; }
    .file-input { display: none; }
    .upload-progress { margin-top: 14px; font-size: 13px; color: #3fb950; display: none; padding: 10px; background: rgba(46, 160, 67, 0.1); border-radius: 8px; border: 1px solid rgba(46, 160, 67, 0.3); }

    /* Footer */
    .footer {
      text-align: center;
      font-size: 12px;
      color: #8b949e;
      border-top: 1px solid #21262d;
      padding-top: 16px;
      margin-top: 10px;
    }
  </style>
</head>
<body>

  <!-- ================= HALAMAN 1: DASHBOARD UTAMA ================= -->
  <div id="page-home" class="page-screen active">
    <div class="card">
      <div class="header">
        <div class="title-group">
          <div class="title">⚡ VPS Control Center</div>
          <span class="badge-root">Console root</span>
          <span class="badge-status"><div class="pulse"></div>Connected</span>
        </div>
        <button class="btn-refresh" onclick="refreshData()">
          <span class="spin-icon" id="spinIcon">🔄</span> Refresh
        </button>
      </div>

      <!-- SSH Commands Section -->
      <div class="cmd-section">
        <div class="section-title">Railway Direct SSH Command</div>
        <div class="cmd-box">
          <span class="cmd-text" id="railwayCmd">${railwaySshCmd}</span>
          <button class="btn-copy" onclick="copyText('railwayCmd', this)">Copy Direct SSH</button>
        </div>

        ${ngrokSshCmd ? `
        <div class="section-title">Ngrok Tunnel SSH Command</div>
        <div class="cmd-box">
          <span class="cmd-text" id="ngrokCmd">${ngrokSshCmd}</span>
          <button class="btn-copy" onclick="copyText('ngrokCmd', this)">Copy Ngrok SSH</button>
        </div>` : ''}
      </div>

      <!-- Detail Grid & Copy Password -->
      <div class="grid">
        <div class="grid-item">
          <div class="section-title">SSH User</div>
          <div class="val" style="color: #58a6ff;">root</div>
        </div>
        <div class="grid-item">
          <div class="section-title">SSH Password</div>
          <div class="val-box">
            <span class="val" id="vpsPass" style="color: #ffa657;">sembakokevin-oss</span>
            <button class="btn-copy-sm" onclick="copyText('vpsPass', this)">Copy Passwd</button>
          </div>
        </div>
        <div class="grid-item">
          <div class="section-title">Railway TCP Host</div>
          <div class="val" id="railwayHost">${RAILWAY_TCP_PROXY_DOMAIN}</div>
        </div>
        <div class="grid-item">
          <div class="section-title">Railway TCP Port</div>
          <div class="val" id="railwayPort" style="color: #79c0ff;">${RAILWAY_TCP_PROXY_PORT}</div>
        </div>
      </div>

      <!-- Button Navigate to Page 2 -->
      <div style="margin-top: 24px; text-align: center;">
        <button class="btn-nav-page2" onclick="showPage('console')">
          🖥️ Buka Console Folder & Terminal (Halaman 2) &rarr;
        </button>
      </div>

      <div class="footer">
        Domain: <b><a href="https://${RAILWAY_PUBLIC_DOMAIN}" style="color: #58a6ff;">${RAILWAY_PUBLIC_DOMAIN}</a></b> • Host: <b>${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}</b> • Service: <b>${RAILWAY_SERVICE_NAME}</b>
      </div>
    </div>
  </div>


  <!-- ================= HALAMAN 2: CONSOLE FOLDER & TERMINAL ================= -->
  <div id="page-console" class="page-screen">
    <div class="card">
      <div class="header">
        <div class="title-group">
          <button class="btn-back" onclick="showPage('home')">&larr; Kembali ke Dashboard Utama</button>
          <span class="badge-root">Console root</span>
          <span class="badge-status"><div class="pulse"></div>Connected</span>
        </div>
      </div>

      <!-- Tabs Navigation -->
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('terminal', this)">💻 VPS Linux Console</button>
        <button class="tab-btn" onclick="switchTab('files', this)">📁 System File Manager (/)</button>
        <button class="tab-btn" onclick="switchTab('upload', this)">📤 Upload File</button>
      </div>

      <!-- Tab 1: Terminal Console -->
      <div id="tab-terminal" class="tab-content active">
        <div class="terminal-window">
          <div class="terminal-header">
            <span>root@${hostname}:/# (Linux Full VPS Console)</span>
            <span style="color:#3fb950;">Active Connection</span>
          </div>
          <div class="terminal-output" id="termOutput">Linux VPS Shell Connected. You have full root privileges across all directories (/root, /etc, /var, /tmp, /usr, etc.)...\n</div>
          <div class="terminal-input-bar">
            <span class="prompt-label" id="termPrompt">root@${hostname}:/#</span>
            <input type="text" class="term-input" id="termInput" placeholder="Ketik perintah (contoh: ls, cd /root, pwd, apt update)..." onkeydown="if(event.key==='Enter') runCmd()">
            <button class="btn-exec" onclick="runCmd()">Eksekusi</button>
          </div>
        </div>
        <div class="quick-cmds">
          <button class="btn-chip" onclick="quickCmd('ls')">ls (Grid)</button>
          <button class="btn-chip" onclick="quickCmd('ls -la')">ls -la (List)</button>
          <button class="btn-chip" onclick="quickCmd('cd /root && ls')">cd /root</button>
          <button class="btn-chip" onclick="quickCmd('cd / && ls')">cd / (Root)</button>
          <button class="btn-chip" onclick="quickCmd('pwd')">pwd</button>
          <button class="btn-chip" onclick="quickCmd('free -m')">free -m (RAM)</button>
          <button class="btn-chip" onclick="quickCmd('df -h')">df -h (Disk)</button>
          <button class="btn-chip" onclick="quickCmd('uname -a')">uname -a</button>
          <button class="btn-chip" onclick="clearTerm()">Clear Screen</button>
        </div>
      </div>

      <!-- Tab 2: File Manager -->
      <div id="tab-files" class="tab-content">
        <div class="fm-toolbar">
          <div class="path-display" id="currentPath">/</div>
          <div class="fm-actions">
            <button class="btn-refresh" onclick="triggerUploadForCurrentDir()">📤 Upload Ke Folder Ini</button>
            <button class="btn-refresh" onclick="loadFiles('/')">🏠 Root (/)</button>
            <button class="btn-refresh" onclick="loadFiles('/root')">📁 /root</button>
            <button class="btn-refresh" onclick="mkdirPrompt()">➕ Buat Folder</button>
            <button class="btn-refresh" onclick="loadFiles(currentDir)">🔄 Reload</button>
          </div>
        </div>
        <input type="file" id="fmFileSelector" class="file-input" multiple onchange="handleFileSelect(this.files)">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Nama File / Folder</th>
                <th>Ukuran</th>
                <th>Terakhir Diubah</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody id="fileTableBody">
              <tr><td colspan="4" style="text-align:center;color:#8b949e;">Loading files...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab 3: File Upload -->
      <div id="tab-upload" class="tab-content">
        <div style="margin-bottom: 16px; background: #0d1117; padding: 14px; border-radius: 10px; border: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size:13px; color:#8b949e;">Folder Tujuan Upload Saat Ini:</span>
          <span style="font-family:monospace; font-size:14px; color:#58a6ff; font-weight:700;" id="uploadTargetDirDisplay">/</span>
        </div>
        <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileSelector').click()">
          <span class="drop-icon">☁️</span>
          <p style="font-weight:600;font-size:15px;margin-bottom:6px;">Tarik & Lepas File Di Sini (Semua Jenis File)</p>
          <p style="font-size:13px;color:#8b949e;">File akan diunggah langsung ke folder aktif di atas</p>
          <input type="file" id="fileSelector" class="file-input" multiple onchange="handleFileSelect(this.files)">
        </div>
        <div class="upload-progress" id="uploadProgress">Uploading...</div>
      </div>

      <!-- Footer -->
      <div class="footer">
        Domain: <b><a href="https://${RAILWAY_PUBLIC_DOMAIN}" style="color: #58a6ff;">${RAILWAY_PUBLIC_DOMAIN}</a></b> • Service: <b>${RAILWAY_SERVICE_NAME}</b>
      </div>
    </div>
  </div>


  <!-- ================= WEB CODE EDITOR MODAL ================= -->
  <div class="modal-overlay" id="editorModal">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-title">✏️ Edit File: <span id="editingFileName" style="color:#bc8cff;">-</span></div>
        <button class="modal-close" onclick="closeEditorModal()">✕</button>
      </div>
      <div class="editor-body">
        <textarea class="code-textarea" id="codeEditorTextarea" spellcheck="false" placeholder="Loading file content..."></textarea>
      </div>
      <div class="modal-footer">
        <span class="save-status" id="saveStatus">✅ File berhasil disimpan!</span>
        <div style="display:flex; gap:10px;">
          <button class="btn-back" onclick="closeEditorModal()">Batal</button>
          <button class="btn-save-file" onclick="saveFileContent()">💾 Simpan File</button>
        </div>
      </div>
    </div>
  </div>


  <script>
    let currentDir = '/';
    let currentlyEditingPath = '';
    const vpsHostname = '${hostname}';

    function showPage(pageId) {
      document.querySelectorAll('.page-screen').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + pageId).classList.add('active');
      if (pageId === 'console') {
        loadFiles(currentDir);
      }
    }

    function switchTab(name, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      if (name === 'files') loadFiles(currentDir);
      if (name === 'upload') updateUploadTargetDisplay();
    }

    function copyText(elementId, btn) {
      const txt = document.getElementById(elementId).innerText;
      navigator.clipboard.writeText(txt).then(() => {
        const oldText = btn.innerText;
        btn.innerText = 'Copied! ✓';
        btn.style.background = '#1f6feb';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.innerText = oldText;
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      });
    }

    function refreshData() {
      const icon = document.getElementById('spinIcon');
      icon.classList.add('spinning');
      loadFiles(currentDir);
      setTimeout(() => icon.classList.remove('spinning'), 800);
    }

    function updateUploadTargetDisplay() {
      document.getElementById('uploadTargetDirDisplay').innerText = currentDir;
    }

    function triggerUploadForCurrentDir() {
      document.getElementById('fmFileSelector').click();
    }

    // --- TERMINAL CONSOLE LOGIC ---
    function runCmd() {
      const input = document.getElementById('termInput');
      const cmd = input.value.trim();
      if (!cmd) return;
      
      appendTerm(\`root@\${vpsHostname}:\${currentDir}# \${cmd}\n\`);
      input.value = '';

      fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, cwd: currentDir })
      })
      .then(res => res.json())
      .then(data => {
        if (data.stdout) appendTerm(data.stdout);
        if (data.stderr) appendTerm(data.stderr);
        if (data.cwd) {
          currentDir = data.cwd;
          document.getElementById('termPrompt').innerText = \`root@\${vpsHostname}:\${currentDir}#\`;
          document.getElementById('currentPath').innerText = currentDir;
          updateUploadTargetDisplay();
        }
      })
      .catch(err => appendTerm(\`[EXEC ERROR] \${err.message}\n\`));
    }

    function quickCmd(cmd) {
      document.getElementById('termInput').value = cmd;
      runCmd();
    }

    function appendTerm(text) {
      const out = document.getElementById('termOutput');
      out.innerText += text;
      out.scrollTop = out.scrollHeight;
    }

    function clearTerm() {
      document.getElementById('termOutput').innerText = '';
    }

    // --- FILE MANAGER LOGIC ---
    function loadFiles(dirPath) {
      currentDir = dirPath;
      document.getElementById('currentPath').innerText = currentDir;
      document.getElementById('termPrompt').innerText = \`root@\${vpsHostname}:\${currentDir}#\`;
      updateUploadTargetDisplay();
      const tbody = document.getElementById('fileTableBody');
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#8b949e;">Loading files...</td></tr>';

      fetch('/api/files?path=' + encodeURIComponent(dirPath))
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          tbody.innerHTML = \`<tr><td colspan="4" style="color:#f85149;">Error: \${data.error}</td></tr>\`;
          return;
        }

        let html = '';
        if (dirPath !== '/') {
          const parentDir = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
          html += \`<tr>
            <td colspan="4">
              <span class="item-name" onclick="loadFiles('\${parentDir}')">📁 <b>.. (Kembali ke folder atas)</b></span>
            </td>
          </tr>\`;
        }

        if (data.items.length === 0) {
          html += '<tr><td colspan="4" style="text-align:center;color:#8b949e;">Folder ini kosong.</td></tr>';
        } else {
          data.items.forEach(item => {
            const sizeStr = item.isDir ? '-' : formatBytes(item.size);
            const dateStr = new Date(item.mtime).toLocaleString('id-ID');
            const icon = item.isDir ? '📁' : '📄';
            const actionClick = item.isDir ? \`loadFiles('\${escapeJs(item.path)}')\` : \`openEditorModal('\${escapeJs(item.path)}')\`;
            
            html += \`<tr>
              <td>
                <span class="item-name" onclick="\${actionClick}">
                  <span>\${icon}</span>
                  <span>\${escapeHtml(item.name)}</span>
                </span>
              </td>
              <td>\${sizeStr}</td>
              <td style="color:#8b949e;">\${dateStr}</td>
              <td>
                \${!item.isDir ? \`<button class="btn-action-sm btn-edit" onclick="openEditorModal('\${escapeJs(item.path)}')">Edit ✏️</button>\` : ''}
                <button class="btn-action-sm btn-del" onclick="deleteItem('\${escapeJs(item.path)}')">Hapus</button>
              </td>
            </tr>\`;
          });
        }
        tbody.innerHTML = html;
      })
      .catch(err => {
        tbody.innerHTML = \`<tr><td colspan="4" style="color:#f85149;">Failed to load files: \${err.message}</td></tr>\`;
      });
    }

    // --- CODE EDITOR LOGIC ---
    function openEditorModal(filePath) {
      currentlyEditingPath = filePath;
      document.getElementById('editingFileName').innerText = filePath;
      document.getElementById('codeEditorTextarea').value = 'Loading file content...';
      document.getElementById('saveStatus').style.display = 'none';
      document.getElementById('editorModal').classList.add('active');

      fetch('/api/readfile?path=' + encodeURIComponent(filePath))
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          document.getElementById('codeEditorTextarea').value = data.content;
        } else {
          alert('Gagal membuka file: ' + (data.error || 'Unknown error'));
          closeEditorModal();
        }
      })
      .catch(err => {
        alert('Gagal membaca file: ' + err.message);
        closeEditorModal();
      });
    }

    function saveFileContent() {
      if (!currentlyEditingPath) return;
      const content = document.getElementById('codeEditorTextarea').value;
      const status = document.getElementById('saveStatus');
      status.innerText = 'Saving...';
      status.style.color = '#79c0ff';
      status.style.display = 'inline';

      fetch('/api/savefile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentlyEditingPath, content: content })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          status.innerText = '✅ File berhasil disimpan!';
          status.style.color = '#3fb950';
          setTimeout(() => status.style.display = 'none', 3000);
          loadFiles(currentDir);
        } else {
          status.innerText = '❌ Gagal menyimpan: ' + data.error;
          status.style.color = '#f85149';
        }
      })
      .catch(err => {
        status.innerText = '❌ Gagal menyimpan: ' + err.message;
        status.style.color = '#f85149';
      });
    }

    function closeEditorModal() {
      document.getElementById('editorModal').classList.remove('active');
      currentlyEditingPath = '';
    }

    function deleteItem(itemPath) {
      if (!confirm('Apakah Anda yakin ingin menghapus: ' + itemPath + ' ?')) return;
      fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          loadFiles(currentDir);
        } else {
          alert('Gagal menghapus: ' + (data.error || 'Unknown error'));
        }
      });
    }

    function mkdirPrompt() {
      const name = prompt('Masukkan nama folder baru:');
      if (!name) return;
      fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: currentDir, name: name })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) loadFiles(currentDir);
        else alert('Gagal membuat folder: ' + data.error);
      });
    }

    // --- FILE UPLOAD LOGIC ---
    function handleFileSelect(files) {
      if (!files || files.length === 0) return;
      const targetDir = currentDir || '/root';
      const prog = document.getElementById('uploadProgress');
      prog.style.display = 'block';
      
      let uploaded = 0;
      Array.from(files).forEach(file => {
        prog.innerHTML = \`Mengunggah <b>\${file.name}</b> ke <code>\${targetDir}</code>...\`;
        fetch(\`/api/upload?dir=\${encodeURIComponent(targetDir)}&filename=\${encodeURIComponent(file.name)}\`, {
          method: 'POST',
          body: file
        })
        .then(res => res.json())
        .then(data => {
          uploaded++;
          if (uploaded === files.length) {
            prog.innerHTML = \`✅ Sukses mengunggah <b>\${files.length} file</b> ke <code>\${targetDir}</code>!\`;
            setTimeout(() => prog.style.display = 'none', 4000);
            loadFiles(targetDir);
          }
        })
        .catch(err => {
          prog.innerHTML = \`❌ Gagal mengunggah \${file.name}: \${err.message}\`;
        });
      });
    }

    // Drag and Drop Upload
    const dropZone = document.getElementById('dropZone');
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    });
    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      handleFileSelect(dt.files);
    });

    // Helper functions
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    function escapeHtml(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function escapeJs(str) { return str.replace(/'/g, "\\'"); }
  </script>
</body>
</html>`;

      res.end(html);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} in use. Switching Node.js Healthcheck server to port 8080...`);
    PORT = 8080;
    setTimeout(() => {
      server.close();
      server.listen(8080, '0.0.0.0');
    }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Node.js VPS Control Center Server listening on 0.0.0.0:${PORT}`);
});
