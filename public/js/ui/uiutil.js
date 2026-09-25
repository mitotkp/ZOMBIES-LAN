// Utilidades compartidas por el HUD y los menús (sin dependencias externas).

// Escapa texto para insertarlo en HTML
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Solo acepta colores hexadecimales (evita inyectar CSS arbitrario desde la red)
export function safeColor(c, fallback = '#ffffff') {
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback;
}

// Generador pseudoaleatorio con semilla (trazos de tiza reproducibles)
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reloj del servidor estimado (o el local si Net no está disponible)
export function serverNow(ctx) {
  try {
    if (ctx && ctx.net && typeof ctx.net.serverNow === 'function') {
      const v = ctx.net.serverNow();
      if (typeof v === 'number' && isFinite(v)) return v;
    }
  } catch { /* se usa el reloj local */ }
  return Date.now();
}

// Reproduce un sonido sin romper nada si el audio no existe
export function sfx(ctx, name, opts) {
  try {
    if (ctx && ctx.audio && typeof ctx.audio.play === 'function') return ctx.audio.play(name, opts);
  } catch { /* sin audio */ }
  return null;
}

// ¿Está activo el modo ?debug=1 (sin pointer lock)?
export function isDebugUrl() {
  try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; }
}

// Filtros SVG de "tiza" compartidos (se referencian con filter:url(#zl-chalk) desde CSS o SVG)
export function ensureChalkDefs() {
  if (typeof document === 'undefined' || document.getElementById('zl-chalk')) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'zl-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  svg.innerHTML = `
    <defs>
      <filter id="zl-chalk" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="4" result="grain"/>
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.05 1.1" numOctaves="2" seed="11" result="streak"/>
        <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.55" result="holes"/>
        <feComposite in="rough" in2="holes" operator="in"/>
      </filter>
      <filter id="zl-chalk-heavy" x="-6%" y="-10%" width="112%" height="120%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="2" result="warp"/>
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="7" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="2" seed="9" result="grain"/>
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.7 1.65" result="holes"/>
        <feComposite in="rough" in2="holes" operator="in"/>
      </filter>
    </defs>`;
  (document.body || document.documentElement).appendChild(svg);
}
