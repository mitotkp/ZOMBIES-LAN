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
  'WASD mover · Ratón mirar · Clic izq. disparar · Clic der. apuntar · Shift correr · C/Ctrl agacharse · Espacio saltar · ' +
  'R recargar · F usar/comprar (mantener para reconstruir, construir y reanimar) · V cuchillo · G granada · Q escudo · ' +
  '1/2/3 o rueda cambiar de arma · Tab puntuaciones · T/Enter chat · Esc pausa';

export const TIPS = [
  'Reconstruye las barricadas manteniendo F: ganas 10 puntos por cada tabla.',
  'Activa la electricidad en la Planta Eléctrica para usar las Perk-a-Colas y el Pack-a-Punch.',
  'La Caja Misteriosa cuesta 950 puntos. Si aparece el osito, la caja se muda a otro lugar.',
  'Reúne las 3 piezas del escudo y constrúyelo en la mesa de trabajo de la calle.',
  'Una baja a la cabeza da 100 puntos; una baja con cuchillo, 130.',
  'Juggernog te permite aguantar 5 golpes en vez de 2.',
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
export const DEFAULT_SETTINGS = {
  sensitivity: 1.0, fov: 75, volume: 0.8, music: 0.5, quality: 'high', invertY: false,
};
