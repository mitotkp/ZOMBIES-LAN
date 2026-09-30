// Datos estáticos de los menús: controles (SPEC 8), consejos y nombres de colores.

export const COLOR_NAMES = ['Blanco', 'Azul', 'Amarillo', 'Verde'];

// Grupos de controles: [teclas, acción]
export const CONTROL_GROUPS = [
  {
    title: 'Movimiento',
    rows: [
      [['W', 'A', 'S', 'D'], 'Moverse'],
      [['Ratón'], 'Mirar'],
      [['Shift'], 'Correr'],
      [['C', 'Ctrl'], 'Agacharse'],
      [['Shift', 'C'], 'Deslizarse (corriendo)'],
      [['Espacio'], 'Saltar'],
    ],
  },
  {
    title: 'Combate',
    rows: [
      [['Clic izq.'], 'Disparar'],
      [['Clic der.'], 'Apuntar'],
      [['R'], 'Recargar'],
      [['V'], 'Cuchillo'],
      [['G'], 'Granada'],
      [['Q'], 'Escudo'],
      [['L'], 'Linterna'],
      [['H'], 'Menú de curas (elige con 1, 2, 3)'],
      [['1', '2', '3', 'Rueda'], 'Cambiar de arma'],
    ],
  },
  {
    title: 'Interacción',
    rows: [
      [['F'], 'Usar / comprar'],
      [['Mantener F'], 'Reconstruir, construir y reanimar'],
    ],
  },
  {
    title: 'Otros',
    rows: [
      [['Tab'], 'Puntuaciones'],
      [['T', 'Enter'], 'Chat'],
      [['Esc'], 'Pausa'],
    ],
  },
  {
    title: 'Mando (PS5 / Xbox)',
    rows: [
      [['Stick izq.'], 'Moverse'],
      [['Stick der.'], 'Mirar'],
      [['L3'], 'Correr'],
      [['○ / B'], 'Agacharse (corriendo: deslizarse)'],
      [['✕ / A'], 'Saltar'],
      [['R2 / RT'], 'Disparar'],
      [['L2 / LT'], 'Apuntar'],
      [['□ / X'], 'Recargar / usar / comprar'],
      [['△ / Y', '→'], 'Cambiar de arma'],
      [['R3'], 'Cuchillo'],
      [['R1 / RB'], 'Granada'],
      [['L1 / LB'], 'Menú de curas (△ elegir, R2 usar)'],
      [['↓'], 'Escudo'],
      [['↑'], 'Linterna'],
      [['Panel táctil'], 'Puntuaciones'],
      [['Options'], 'Pausa'],
    ],
  },
];

// Versión corta para la pantalla de título
export const CONTROLS_SHORT = [
  [['W', 'A', 'S', 'D'], 'Moverse'],
  [['Clic izq.'], 'Disparar'],
  [['Clic der.'], 'Apuntar'],
  [['Shift'], 'Correr'],
  [['C'], 'Agacharse'],
  [['Espacio'], 'Saltar'],
  [['R'], 'Recargar'],
  [['F'], 'Usar / comprar'],
  [['V'], 'Cuchillo'],
  [['G'], 'Granada'],
  [['Q'], 'Escudo'],
  [['1', '2', '3'], 'Armas'],
  [['Tab'], 'Puntuaciones'],
  [['T'], 'Chat'],
  [['Esc'], 'Pausa'],
];

export const CONTROLS_LINE =
  'WASD mover · Ratón mirar · Clic izq. disparar · Clic der. apuntar · Shift correr · C/Ctrl agacharse (corriendo: deslizarse) · Espacio saltar · ' +
  'R recargar · F usar/comprar (mantener para reconstruir, construir y reanimar) · V cuchillo · G granada · Q escudo · L linterna · H menú de curas · ' +
  '1/2/3 o rueda cambiar de arma · Tab puntuaciones · T/Enter chat · Esc pausa';

export const TIPS = [
  'Reconstruye las barricadas manteniendo F: ganas 10 puntos por cada tabla.',
  'Activa la electricidad en la Planta Eléctrica para usar las Perk-a-Colas y el Pack-a-Punch (Quick Revive funciona sin ella).',
  'La Caja Misteriosa cuesta 950 puntos. Si aparece el osito, la caja se muda a otro lugar.',
  'Reúne las 3 piezas del escudo y constrúyelo en la mesa de trabajo de la calle.',
  'Pulsa H para abrir el menú de curas y elige con 1, 2 o 3: vendas, antídotos y botiquines se compran en los armarios con una cruz roja.',
  'Desde la ronda 5 aparece un jefe cada ronda: mira su barra de vida arriba y busca su punto débil.',
  'Una baja a la cabeza da 100 puntos; una baja con cuchillo, 130.',
  'Juggernog te permite aguantar 10 golpes en vez de 4.',
  'Si caes, un compañero puede reanimarte manteniendo F. Con Quick Revive tarda la mitad.',
  'El Pack-a-Punch (5000) mejora el arma que tienes en la mano.',
  'Max Ammo llena la munición de todas tus armas y tus granadas.',
  'Los potenciadores parpadean antes de desaparecer: recógelos rápido.',
  'Con Speed Cola recargas y reconstruyes el doble de rápido.',
  'El escudo en la espalda te protege de los golpes por detrás.',
  'Los zombis solo entran por las ventanas de las zonas abiertas.',
  'Con Doble Puntos, cada impacto y cada baja valen el doble.',
];

// Valores por defecto de los ajustes (SPEC 6.1)
// Opciones gráficas independientes de `quality` (que sigue siendo el detalle de modelos y efectos).
export const GFX_DEFAULTS = {
  shadows: 'high',       // 'off' | 'low' | 'high' (resolución del mapa de sombras)
  renderScale: 1,        // 0.5..1.5: multiplica la resolución interna
  dynRes: true,          // bajar la resolución sola si no se llega a ~50 FPS
  antialias: true,       // suavizado de bordes (se aplica al recargar)
  fog: 1,                // 0.5..1.5: densidad de la niebla
  fpsCap: 0,             // 0 = sin límite | 30 | 60 | 120 | 144
  showFps: false,
  cameraMotion: 1,       // 0..1: balanceo al caminar y sacudidas de cámara
};
export const FPS_CAPS = [0, 30, 60, 120, 144];

// Normaliza las opciones gráficas de `s` (in situ). Si faltan (ajustes guardados de antes), las deriva de
// `quality` para no cambiarle el aspecto al jugador: calidad baja = sin sombras ni suavizado.
export function sanitizeGfx(s) {
  const d = GFX_DEFAULTS;
  const low = s.quality === 'low';
  const num = (v, def, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : def; };
  s.shadows = ['off', 'low', 'high'].includes(s.shadows) ? s.shadows : (low ? 'off' : d.shadows);
  s.renderScale = Math.round(num(s.renderScale, low ? 0.85 : d.renderScale, 0.5, 1.5) * 20) / 20;
  s.dynRes = typeof s.dynRes === 'boolean' ? s.dynRes : d.dynRes;
  s.antialias = typeof s.antialias === 'boolean' ? s.antialias : !low;
  s.fog = num(s.fog, d.fog, 0.5, 1.5);
  s.fpsCap = FPS_CAPS.includes(Number(s.fpsCap)) ? Number(s.fpsCap) : d.fpsCap;
  s.showFps = !!s.showFps;
  s.cameraMotion = num(s.cameraMotion, d.cameraMotion, 0, 1);
  return s;
}

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0, fov: 75, volume: 0.8, music: 0.5, quality: 'high', invertY: false, brightness: 1.0,
  ...GFX_DEFAULTS,
};
