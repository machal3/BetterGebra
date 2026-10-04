import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (file.includes('..') || !['index.html', 'style.css', 'app.js', 'math.js'].includes(file)) { res.writeHead(404); return res.end('Not found'); }
    res.setHeader('Content-Type', `${types[path.extname(file)] || 'text/plain'}; charset=utf-8`);
    res.end(await readFile(new URL(file, import.meta.url)));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const listen = p => server.listen(p, '0.0.0.0');
server.on('listening', () => console.log(`Bettergebra: http://localhost:${server.address().port}`));
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  const next = e.port + 1;
  console.warn(`Port ${e.port} zajęty, próbuję ${next}...`);
  listen(next);
});
listen(port);
