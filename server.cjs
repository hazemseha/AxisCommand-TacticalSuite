const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const DIST_DIR = path.join(__dirname, 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Enable local CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Return Local Wi-Fi IP
  if (req.method === 'GET' && req.url === '/api/ip') {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIp = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ip: localIp, port: PORT }));
  }

  // 2. Upload file for Wi-Fi Sync sharing
  if (req.method === 'POST' && req.url === '/api/sync/upload') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      fs.writeFileSync(path.join(DIST_DIR, 'sync.pinvault'), Buffer.concat(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      console.log('[+] AirDrop Sync Hosted (sync.pinvault)');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'shutting down' }));
    console.log('\n[+] Exit signal received from PinVault Dashboard!');
    console.log('[+] All data is safely saved in local cache.');
    console.log('[+] Shutting down local server...');
    process.exit(0);
  }

  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);
  
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

function startServer(portAttempt) {
  if (portAttempt > PORT + 20) {
    console.error('[!] Could not bind to any port between 8000-8020.');
    process.exit(1);
  }

  server.listen(portAttempt, '0.0.0.0', () => {
    const finalPort = portAttempt;
    console.log(`[*] Serving PinVault Offline Engine at http://0.0.0.0:${finalPort}`);
    console.log(`[*] Opening Application...`);
    
    const { exec } = require('child_process');
    const url = `http://localhost:${finalPort}`;
    const cmd = `start "" chrome.exe --app="${url}" 2>nul || start "" msedge.exe --app="${url}" 2>nul || start ${url}`;

    exec(cmd, (err) => {
      if (err) console.error('[!] Failed to automatically launch browser.');
    });
    
    console.log(`[*] (The server will automatically close when you click the 'Exit' button in the app)`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      startServer(portAttempt + 1);
    } else {
      console.error('[!] Server Error:', e);
      process.exit(1);
    }
  });
}

startServer(PORT);
