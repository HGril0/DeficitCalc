// Serve a pasta da app como o Cloudflare Pages faria, com os cabeçalhos do
// ficheiro _headers. Em modo de teste tira o atributo integrity do HTML,
// porque a biblioteca é substituída por um falso (a impressão digital da
// verdadeira foi verificada à parte, num browser real).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const RAIZ = process.argv[2];
const PORTA = Number(process.argv[3] || 8099);
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function cabecalhos() {
  const f = path.join(RAIZ, '_headers');
  if (!fs.existsSync(f)) return {};
  const h = {}; let dentro = false;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (l.startsWith('#') || !l.trim()) continue;
    if (!l.startsWith(' ')) { dentro = l.trim() === '/*'; continue; }
    if (dentro) { const i = l.indexOf(':'); h[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  }
  return h;
}
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(RAIZ, path.normalize(p));
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  let corpo = fs.readFileSync(f);
  const ext = path.extname(f);
  if (ext === '.html') corpo = Buffer.from(corpo.toString('utf8').replace(/\s+integrity="[^"]*"/g, ''));
  res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream', ...cabecalhos() });
  res.end(corpo);
}).listen(PORTA, '127.0.0.1', () => console.log('a servir ' + RAIZ + ' em ' + PORTA));
