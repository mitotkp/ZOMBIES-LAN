// Punto de entrada del servidor: HTTP estático (sin Express) + WebSocket en el mismo puerto.
// Uso: node server/index.js [--port 3000] [--dev]    (también PORT=3000 y DEV=1 por entorno)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { DEFAULT_PORT, GAME_TITLE, MAX_PLAYERS } from '../shared/constants.js';
import { MAP_NAME } from '../shared/map.js';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ argumentos

function parseArgs(argv) {
  const out = { port: null, dev: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') out.dev = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--port' || a === '-p') out.port = argv[++i];
    else if (a.startsWith('--port=')) out.port = a.slice(7);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const envDev = /^(1|true|yes|si|sí)$/i.test(process.env.DEV || '');
const DEV = args.dev || envDev;
let PORT = parseInt(args.port ?? process.env.PORT ?? DEFAULT_PORT, 10);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) PORT = DEFAULT_PORT;

// ------------------------------------------------------------------ archivos estáticos

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

function resolveThreeDir() {
  const local = path.join(ROOT, 'node_modules', 'three');
  if (fs.existsSync(local)) return local;
  try {
    const require = createRequire(import.meta.url);
    return path.dirname(require.resolve('three/package.json'));
  } catch {
    return local;
  }
}

// Prefijo de URL → carpeta en disco (el orden importa: el más específico primero)
const MOUNTS = [
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/vendor/three/', dir: resolveThreeDir() },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];

// Traduce la ruta pedida a un archivo dentro de la carpeta montada, o null si intenta salirse
function resolvePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  decoded = decoded.replace(/\\/g, '/');
  for (const m of MOUNTS) {
    if (!decoded.startsWith(m.prefix)) continue;
    const rel = decoded.slice(m.prefix.length);
    const base = path.resolve(m.dir);
    const full = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return { full, base };
  }
  return null;
}

function sendText(res, status, text, method = 'GET') {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(method === 'HEAD' ? undefined : text);
}

function serveFile(req, res, file, stat) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  const ims = req.headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(ims);
    if (Number.isFinite(since) && Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000)) {
      res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': headers['Last-Modified'] });
      res.end();
      return;
    }
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => { try { res.destroy(); } catch { /* nada */ } });
  stream.pipe(res);
}

function handleRequest(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, 'Método no permitido');
      return;
    }
    const urlPath = (req.url || '/').split('?')[0].split('#')[0] || '/';
    const r = resolvePath(urlPath);
    if (!r) { sendText(res, 403, 'Acceso denegado', req.method); return; }
    let file = r.full;
    fs.stat(file, (err, stat) => {
      if (!err && stat.isDirectory()) {
        file = path.join(file, 'index.html');
        fs.stat(file, (err2, stat2) => {
          if (err2 || !stat2.isFile()) { sendText(res, 404, 'No encontrado', req.method); return; }
          serveFile(req, res, file, stat2);
        });
        return;
      }
      if (err || !stat.isFile()) { sendText(res, 404, 'No encontrado', req.method); return; }
      serveFile(req, res, file, stat);
    });
  } catch (e) {
    console.error('[http] error:', e);
    try { sendText(res, 500, 'Error interno'); } catch { /* nada */ }
  }
}

// ------------------------------------------------------------------ direcciones LAN

// Puntuación para ordenar: primero la red local física (Wi-Fi/Ethernet), al final VPN y adaptadores virtuales
const VIRTUAL_IFACE = /(vpn|proton|tailscale|zerotier|hamachi|radmin|wireguard|vethernet|virtualbox|vmware|vbox|wsl|hyper-v|docker|tap|tun|loopback|bluetooth|npcap)/i;
const PHYSICAL_IFACE = /^(wi-?fi|wlan|ethernet|eth|en|wl|local area connection|conexi)/i;
function addressScore(name, a) {
  let s = 0;
  const ip = a.address;
  if (PHYSICAL_IFACE.test(name)) s += 40;
  if (VIRTUAL_IFACE.test(name)) s -= 60;
  if (a.netmask === '255.255.255.255') s -= 30; // enlace punto a punto (típico de VPN)
  if (ip.startsWith('192.168.')) s += 20;
  else if (ip.startsWith('10.')) s += 15;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 5;
  const second = Number(ip.split('.')[1]);
  if (ip.startsWith('100.') && second >= 64 && second <= 127) s -= 40; // CGNAT (Tailscale y similares)
  return s;
}

function lanAddresses(port) {
  const found = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      const fam = typeof a.family === 'string' ? a.family : (a.family === 4 ? 'IPv4' : 'IPv6');
      if (fam !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // enlace local sin DHCP: no sirve
      found.push({ url: `http://${a.address}:${port}`, score: addressScore(name, a), name });
    }
  }
  found.sort((x, y) => y.score - x.score);
  const seen = new Set();
  return found.filter((f) => !seen.has(f.url) && seen.add(f.url)).map((f) => f.url);
}

// ------------------------------------------------------------------ arranque

const server = http.createServer(handleRequest);
server.keepAliveTimeout = 5000;
const lan = lanAddresses(PORT);
const rooms = new RoomManager({
  dev: DEV, lan, quiet: args.quiet,
  allowedOrigins: process.env.ALLOWED_ORIGINS || '',
  maxConnPerIp: process.env.MAX_CONN_PER_IP,
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  try {
    if (typeof ws.setNoDelay === 'function') ws.setNoDelay(true);
    if (req.socket && typeof req.socket.setNoDelay === 'function') req.socket.setNoDelay(true);
    rooms.handleConnection(ws, req);
  } catch (e) {
    console.error('[ws] error al aceptar la conexión:', e);
    try { ws.close(); } catch { /* nada */ }
  }
});
wss.on('error', (e) => console.error('[ws] error:', e && e.message ? e.message : e));

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\nEl puerto ${PORT} ya está en uso. ¿Hay otro servidor abierto?`);
    console.error(`Cierra el otro servidor o usa otro puerto: node server/index.js --port ${PORT + 1}\n`);
  } else if (e && e.code === 'EACCES') {
    console.error(`\nNo hay permiso para usar el puerto ${PORT}. Prueba con otro: --port 3000\n`);
  } else {
    console.error('[http] error del servidor:', e);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const line = '='.repeat(62);
  console.log(line);
  console.log(`  ${GAME_TITLE}  —  servidor listo${DEV ? '  [MODO DESARROLLO]' : ''}`);
  console.log(`  Mapa: ${MAP_NAME}   ·   Jugadores: 1 a ${MAX_PLAYERS}`);
  console.log(line);
  console.log(`  Juega en este equipo:  http://localhost:${PORT}`);
  if (lan.length) {
    console.log(`  Comparte esta dirección con tus amigos: ${lan[0]}`);
    for (const u of lan.slice(1)) console.log(`  (otras redes de este equipo):          ${u}`);
    console.log('  Tus amigos deben estar en la misma red (Wi-Fi o cable) y abrirla en su navegador.');
    console.log('  Si no pueden entrar, permite Node.js en el Firewall de Windows (redes privadas).');
  } else {
    console.log('  No se encontró ninguna dirección de red local: conéctate a una red para jugar con amigos.');
  }
  if (DEV) console.log('  Modo desarrollo: escribe /help en el chat del juego para ver los comandos.');
  console.log('  Pulsa Ctrl+C para detener el servidor.');
  console.log(line);
});

// ------------------------------------------------------------------ apagado y errores

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nDeteniendo el servidor...');
  try { rooms.close(); } catch { /* nada */ }
  try { wss.close(); } catch { /* nada */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => {
  console.error('[fatal] excepción no capturada:', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  console.error('[fatal] promesa rechazada sin manejar:', e);
});

export { server, rooms, wss };
