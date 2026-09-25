# ZOMBIES LAN — Especificación técnica (contrato entre módulos)

Shooter cooperativo en primera persona inspirado en el modo **Zombies de Call of Duty: Black Ops 2**.
Servidor **Node.js** (autoritativo) + cliente **navegador** con **Three.js**. Partidas **LAN** de 1 a 4 jugadores:
el anfitrión ejecuta `npm start` y los amigos abren `http://IP-DEL-ANFITRION:3000` en su navegador.

Todo el arte y el audio son **procedurales** (geometría Three.js, texturas en canvas, síntesis WebAudio):
no se usan assets externos ni se descargan recursos de internet en tiempo de ejecución (la LAN puede no tener internet).

Idioma de la interfaz: **español neutro** (tú, no vos; sin modismos rioplatenses). Los nombres icónicos de BO2
se mantienen en inglés (Juggernog, Speed Cola, Pack-a-Punch, Ray Gun, Max Ammo...).

---------------------------------------------------------------------------------------------------

## 0. Estructura de archivos y responsables

```
ZOMBIES_LAN/
  package.json                 (type: module; deps: three 0.186.1, ws 8.21.3)  [HECHO]
  SPEC.md                      este documento                                   [HECHO]
  shared/                      módulos ES compartidos servidor/cliente          [HECHO — NO MODIFICAR sin avisar]
    constants.js               constantes de juego y fórmulas (vida, cantidad de zombis, puntos...)
    map.js                     mapa, cuadrícula, interactuables
    collision.js               colisión círculo-cuadrícula, raycast del mapa, hitbox de zombi
    weapons.js                 armas + Pack-a-Punch
    perks.js                   ventajas
    protocol.js                nombres de mensajes, banderas, códigos de animación
  tools/validate-map.js        [HECHO]
  tools/bot-test.js            bots headless de prueba                          [SERVIDOR]
  server/
    index.js                   HTTP estático + WebSocket + arranque              [SERVIDOR]
    game.js                    clase Game: estado, mensajes, economía, reglas     [SERVIDOR]
    zombies.js                 ZombieManager: rondas, aparición, IA, daño         [SERVIDOR]
    nav.js                     campos de flujo (BFS) sobre la cuadrícula          [SERVIDOR]
  public/
    index.html                 shell, import map, contenedores DOM               [NÚCLEO]
    css/style.css              estilos de HUD y menús                            [UI]
    js/main.js                 arranque, ctx, bucle principal                     [NÚCLEO]
    js/eventbus.js             bus de eventos                                     [NÚCLEO]
    js/net.js                  WebSocket, reloj, interpolación de snapshots       [NÚCLEO]
    js/input.js                teclado/ratón, pointer lock, acciones              [NÚCLEO]
    js/player.js               controlador del jugador local, cámara              [NÚCLEO]
    js/interaction.js          detección de interactuables y avisos "Pulsa F"     [NÚCLEO]
    js/world/level.js          clase World: geometría del mapa, luces, cielo       [MUNDO]
    js/world/textures.js       texturas procedurales en canvas                    [MUNDO]
    js/world/props.js          máquinas, caja, PaP, puertas, ventanas, tiza...     [MUNDO]
    js/world/powerups.js       potenciadores en el suelo                           [MUNDO]
    js/weapons/models.js       modelos procedurales de armas, escudo, camuflaje PaP [ARMAS]
    js/weapons/viewmodel.js    brazos + arma en primera persona, animaciones       [ARMAS]
    js/weapons/weaponSystem.js clase WeaponSystem: disparo, recarga, ADS, granadas... [ARMAS]
    js/weapons/projectiles.js  proyectiles y granadas simulados                    [ARMAS]
    js/entities/entities.js    clase EntityManager: zombis y jugadores remotos      [ENTIDADES]
    js/entities/zombieModel.js modelo y animación de zombi                         [ENTIDADES]
    js/entities/playerModel.js modelo de jugador remoto                            [ENTIDADES]
    js/entities/effects.js     clase Effects: partículas (sangre, chispas, explosiones...) [ENTIDADES]
    js/ui/hud.js               clase HUD                                           [UI]
    js/ui/menus.js             clase Menus: título, lobby, pausa, ajustes, fin      [UI]
    js/audio.js                clase Audio: síntesis de sonidos, música, locutor   [UI/AUDIO]
  README.md                    instrucciones de uso en español                     [NÚCLEO]
  start-server.bat             doble clic para iniciar en Windows                  [SERVIDOR]
```

Cada responsable crea **solo sus archivos**. Puede crear archivos auxiliares extra dentro de su carpeta.
Si necesita algo de otro módulo, usa exactamente la API de este documento.

Importaciones en el navegador: módulos ES nativos, sin bundler.
- `import * as THREE from 'three';` y addons con `import { ... } from 'three/addons/...'` (import map en index.html).
- Módulos compartidos: `import { ... } from '/shared/map.js';` (ruta absoluta servida por el servidor).
- Entre módulos del cliente: rutas relativas (`'./net.js'`, `'../weapons/models.js'`).

El servidor sirve:
- `/` → `public/` (index.html por defecto)
- `/shared/*` → `shared/`
- `/vendor/three/*` → `node_modules/three/*` (se usan `build/three.module.js`, `build/three.core.js` y `examples/jsm/...`)

Import map (en index.html):
```html
<script type="importmap">
{ "imports": { "three": "/vendor/three/build/three.module.js", "three/addons/": "/vendor/three/examples/jsm/" } }
</script>
```

---------------------------------------------------------------------------------------------------

## 1. Convenciones

- Unidades: metros, segundos. Tiempos absolutos del servidor en **ms** (`Date.now()` del servidor).
- Cuadrícula: 1 celda = 1 m; la celda (x,z) ocupa [x,x+1]×[z,z+1]. Centro = (x+0.5, z+0.5). Suelo y=0.
- Norte = −Z, Sur = +Z, Este = +X, Oeste = −X.
- **Yaw**: rotación alrededor de Y, convención Three.js: yaw=0 mira hacia −Z. Adelante = (−sin yaw, 0, −cos yaw).
  `object.rotation.y = yaw` hace que un modelo cuyo frente apunta a −Z mire hacia yaw. Usar `forwardXZ` y `yawTo` de constants.js.
- **Pitch**: positivo = mirar hacia arriba. Límite ±1.5 rad.
- Todos los modelos procedurales se construyen con el **frente hacia −Z** y los pies en y=0.
- IDs de jugador: enteros (1, 2, 3...). IDs de zombi: enteros incrementales.
- Colores de jugador: `PLAYER_COLORS` de constants.js.

---------------------------------------------------------------------------------------------------

## 2. Resumen de reglas de juego (BO2)

- 1–4 jugadores. Se empieza en la **Terminal** (zona 0) con la M1911 (8/80), 2 granadas y 500 puntos.
- Los zombis aparecen en los **callejones** detrás de las **ventanas con barricada** (6 tablas). Arrancan las tablas
  (1 s por tabla) y, cuando no queda ninguna, cruzan (1.2 s) y persiguen a los jugadores.
  Los jugadores reconstruyen tablas manteniendo F (+10 puntos por tabla, máximo 500 por ronda).
- Solo aparecen zombis en ventanas de **zonas abiertas**. Abrir puertas o escombros cuesta puntos y abre las 2 zonas.
- Puntos: +10 por impacto sin matar, +60 baja al cuerpo, +100 baja a la cabeza, +130 baja a cuchillo. Doble Puntos ×2.
- Rondas: la cantidad y la vida de los zombis siguen las fórmulas de `constants.js`. Entre rondas hay 10 s de pausa.
- **Armas de pared** (tiza en la pared): comprar el arma o su munición (mitad de precio; 4500 si está mejorada).
- **Caja misteriosa** (950): gira 4.5 s y ofrece un arma aleatoria durante 12 s (solo para quien pagó). Tras ≥4 usos
  en un lugar puede salir el **osito** (18%): se devuelven los 950 y la caja se muda a otra ubicación.
- **Perk-a-Colas** (requieren electricidad, máximo 4): Quick Revive, Juggernog, Speed Cola, Double Tap, Stamin-Up, Mule Kick.
- **Pack-a-Punch** (5000, requiere electricidad): mejora el arma que tienes en la mano (4.5 s), recógela en 15 s.
- **Electricidad**: palanca en la Planta Eléctrica.
- **Escudo antidisturbios**: reunir 3 piezas repartidas por el mapa (compartidas por el equipo), construirlo en la mesa
  de trabajo (mantener F 3 s). Cada jugador puede tomar uno. En las manos bloquea golpes frontales y permite golpear
  (empuja y daña); en la espalda bloquea golpes por detrás. Tiene 1500 de vida; al romperse se puede tomar otro en la mesa.
- **Potenciadores** (3% por baja, máx. 4 por ronda): Max Ammo, Insta-Kill, Doble Puntos, Bomba Nuclear, Carpintero, Liquidación.
- **Caer**: con 0 de salud el jugador cae ("última batalla": pistola, se arrastra). Pierde todas sus ventajas, la 3.ª arma
  y el 5% de sus puntos. Un compañero lo reanima manteniendo F (4 s; 2 s con Quick Revive). A los 45 s se desangra y
  espera a la siguiente ronda para reaparecer con la M1911. En solitario, Quick Revive (500) reanima solo (máx. 3 veces).
  Sin compañeros en pie → **fin de la partida**.

---------------------------------------------------------------------------------------------------

## 3. Estado de juego `gs` (servidor → clientes)

El servidor mantiene un objeto de estado y lo envía completo como `{ t:'gs', ...estado }` cada vez que cambia
(máximo `GS_MAX_RATE` = 10 veces/s; agrupar cambios). El cliente reemplaza `ctx.gs` entero con cada mensaje.

```js
{
  t: 'gs',
  now: 1727280000000,            // Date.now() del servidor al enviar
  phase: 'lobby' | 'playing' | 'gameover',
  round: 0,                      // 0 antes de la primera ronda
  roundState: 'pre' | 'active' | 'intermission',
  roundUntil: 0,                 // ms: cuándo empieza la siguiente ronda (en 'pre' e 'intermission')
  zLeft: 0,                      // zombis que faltan por matar en la ronda (por aparecer + vivos)
  power: false,
  doors: { A: true },            // solo puertas ABIERTAS
  openZones: [0],                // zonas accesibles
  windows: [6,6,6,6,6,6,6,6,6,6,6,6,6],   // tablas por ventana (índice = id de ventana)
  box: {
    loc: 0,                      // ubicación principal actual (BOX_LOCATIONS)
    uses: 0,                     // usos en la ubicación actual
    slots: [                     // una entrada por ubicación (4)
      { state: 'idle'|'off'|'spinning'|'ready'|'teddy'|'arriving', user: null|pid, weapon: null|key, until: 0 },
      ...
    ],
  },
  pap: { state: 'idle'|'working'|'ready', user: null|pid, weapon: null|key, until: 0 },
  shield: { parts: [false,false,false], built: false, builder: null|pid, buildUntil: 0 },
  powerups: [ { id: 1, type: 'maxammo', x: 10.2, z: 25.7, until: ms } ],
  timers: { instakill: 0, doublepoints: 0, firesale: 0 },   // ms de fin (0 = inactivo)
  players: {
    "1": {
      id: 1, name: 'Max', color: '#ffffff', host: true, ready: false, spawn: 0,  // índice en PLAYER_SPAWNS
      points: 500, kills: 0, headshots: 0, downs: 0, revives: 0,
      state: 'alive' | 'down' | 'dead',    // 'dead' = se desangró o entró a mitad de partida; espera la próxima ronda
      hp: 100, maxHp: 100,
      perks: ['juggernog'],
      weapons: [ { k: 'm1911', up: false }, { k: 'mp5', up: true } ],   // 2 (3 con Mule Kick); puede quedar vacío tras un PaP
      cur: 0,                        // índice de arma en la mano (lo informa el cliente)
      grenades: 2,
      melee: 'knife' | 'bowie',
      shield: null | { hp: 1500 },
      bleedUntil: 0,                 // ms en que se desangra (estado 'down')
      selfReviveAt: 0,               // ms de auto-reanimación en solitario (0 si no aplica)
      reviver: null | pid,           // quién lo está reanimando
      reviveUntil: 0,                // ms en que termina la reanimación en curso
      qrUses: 0,                     // auto-reanimaciones en solitario usadas
      ping: 0,
    }
  }
}
```

---------------------------------------------------------------------------------------------------

## 4. Protocolo (JSON por WebSocket, ver `shared/protocol.js`)

### 4.1 Cliente → Servidor

| t | Campos | Notas |
|---|---|---|
| `hello` | `name, color` | primer mensaje tras conectar |
| `ready` | `v` | en el lobby |
| `start` | — | solo anfitrión, en el lobby |
| `st` | `p:[x,y,z], yaw, pitch, f, cur` | 20 Hz. `p` = pies. `f` = banderas `PF`. `cur` = índice de arma en la mano |
| `fire` | `w, up, o:[x,y,z], d:[dx,dy,dz], e:[x,y,z], hits:[[zid, part, dist], ...]` | un mensaje por disparo (todos los perdigones juntos). `e` = punto final del trazador. `part` ∈ `'h','b','l'`. Un mismo zid puede repetirse (varios perdigones) |
| `proj` | `w, up, o, d` | proyectil lanzado (Ray Gun, Mustang & Sally, War Machine); solo visual para los demás |
| `nade` | `o, v:[vx,vy,vz]` | granada lanzada; el servidor descuenta una granada |
| `boom` | `w, up, p:[x,y,z], direct` | impacto de proyectil propio o explosión de granada propia (`w='frag'`). `direct` = zid alcanzado de lleno o `null` |
| `melee` | `hits:[zid...], shield` | cuchillo o golpe con escudo |
| `use` | `id` | interactuable de pulsación (ver 4.3) |
| `hold` | `id, on` | interactuable de mantener: `win:N`, `bench`, `revive:PID`. `on:false` al soltar |
| `chat` | `msg` | máx. 120 caracteres. En modo desarrollo, los mensajes que empiezan con `/` son comandos (ver 5.12) |
| `ping` | `c` | tiempo del cliente; el servidor responde `pong` |

### 4.2 Servidor → Cliente

| t | Campos |
|---|---|
| `welcome` | `id, host, gs, lan:[urls], dev:bool` |
| `gs` | estado completo (sección 3) |
| `snap` | `now, z:[[id,x,z,rot,anim,flags,yOff]...], p:[[id,x,y,z,yaw,pitch,flags,w,up]...]` (20 Hz) |
| `ev` | `e` + datos (tabla 4.4) |
| `pong` | `c, now` |
| `kick` | `reason` (partida llena, etc.) |

Snapshot: valores redondeados a 2 decimales. `anim` = código `ZA`, `flags` = bits `ZF`. `w` = clave de arma en la mano (o `''`),
`up` = 0/1. Los zombis que ya no están en el snapshot desaparecen (si murieron llegó antes un `zdie`).

### 4.3 Interactuables (`use` / `hold`)

Los ids vienen de `INTERACTABLES` en `shared/map.js`, más `revive:PID`. El servidor valida que el jugador esté vivo y a menos de
`it.range + 0.8` m del punto `(it.x, it.z)` del interactuable (o `PLAYER.reviveRange + 0.8` del caído).

| id | Tipo | Acción del servidor |
|---|---|---|
| `door:X` | use | abre la puerta si hay puntos |
| `wall:wbN` | use | compra el arma (o munición si ya la tiene; Bowie: mejora el cuchillo) |
| `perk:KEY` | use | compra la ventaja (requiere electricidad, límite 4) |
| `power` | use | activa la electricidad |
| `box:N` | use | si el slot N está `idle`: paga y abre. Si está `ready` y `user` = jugador: entrega el arma |
| `pap` | use | si `idle`: paga y mejora el arma en la mano (`cur`). Si `ready` y es suyo: entrega el arma mejorada |
| `part:N` | use | recoge la pieza del escudo (compartida por el equipo) |
| `bench` | use | si el escudo está construido y el jugador no tiene uno: toma un escudo |
| `bench` | hold | si están las 3 piezas y no está construido: construye (3 s manteniendo) |
| `win:N` | hold | reconstruye una tabla cada `REPAIR_TIME` s (la mitad con Speed Cola) mientras mantenga |
| `revive:PID` | hold | reanima al caído (4 s, 2 s con Quick Revive) mientras mantenga y esté cerca |

### 4.4 Eventos (`{ t:'ev', e, ... }`)

"Todos" = difusión; "−autor" = a todos menos quien lo originó; "solo pid" = únicamente a ese jugador.

| e | Datos | Destino | Uso en el cliente |
|---|---|---|---|
| `fire` | `pid, w, up, o, d, e` | −autor | sonido 3D y trazador de otros jugadores |
| `proj` | `pid, w, up, o, d` | −autor | simular el proyectil visualmente |
| `nade` | `pid, o, v` | −autor | simular la granada visualmente |
| `boom` | `pid, w, up, p, r` | todos | explosión (visual + sonido) — también para el autor |
| `zhit` | `id, pid, part` | −autor | sangre en el zombi (el autor ya la predijo) |
| `zdie` | `id, pid, part, fx` | todos | muerte: `fx` ∈ `'normal','head','explode','melee','nuke','fire','shield'` |
| `zatk` | `id, pid, hit, blocked` | todos | golpe de zombi (sonido); si `pid` = yo y `hit`: indicador de daño |
| `pts` | `pid, n` | solo pid | "+N" junto a los puntos (N puede ser negativo) |
| `down` | `pid` | todos | jugador caído |
| `revived` | `pid, by` | todos | reanimado (`by` = pid o `null` si fue auto-reanimación) |
| `bleedout` | `pid` | todos | se desangró |
| `respawn` | `pid, x, z, yaw` | todos | reaparece (inicio de partida o de ronda) |
| `roundStart` | `round` | todos | animación del número de ronda + música |
| `roundEnd` | `round` | todos | música de fin de ronda |
| `door` | `id, pid` | todos | abrir puerta/escombros |
| `power` | `pid` | todos | electricidad activada |
| `buy` | `pid, kind, item` | todos | `kind` ∈ `'weapon','ammo','perk','box','pap','door','bowie'`; el comprador oye la "caja registradora" |
| `deny` | `reason` | solo pid | `'points','power','limit','full','busy','owned'` → sonido de error + mensaje |
| `give` | `pid, slot` | solo pid | el arma del `slot` es nueva: llenar munición y cambiar a ella |
| `ammo` | `pid, slot` | solo pid | recargar munición de reserva (slot `null` = todas) |
| `perk` | `pid, perk` | todos | animación de beber (pid) + jingle en la máquina |
| `boxOpen` | `loc, pid` | todos | abrir tapa y girar armas |
| `boxTeddy` | `loc` | todos | osito + risa |
| `boxMove` | `from, to` | todos | la caja se va volando / aparece |
| `papStart` | `pid, weapon` | todos | la máquina "traga" el arma |
| `papReady` | `pid, weapon` | todos | el arma mejorada sale |
| `pu` | `type, pid, x, z` | todos | potenciador recogido: locutor, efectos; `maxammo` → recargar todo; `nuke` → destello |
| `puSpawn` | `id, type, x, z` | todos | sonido de aparición |
| `part` | `id, pid` | todos | pieza recogida |
| `built` | `pid` | todos | escudo construido |
| `shieldTake` | `pid` | todos | alguien tomó un escudo |
| `shieldHit` | `pid` | todos | golpe bloqueado por el escudo |
| `shieldBreak` | `pid` | todos | escudo destruido |
| `board` | `win, n, pid` | todos | tabla arrancada (`pid` null) o reparada (`pid`); `n` = tablas actuales |
| `chat` | `pid, name, msg` | todos | chat (incluye mensajes del sistema con `pid` 0) |
| `gameover` | `round, stats:[{id,name,color,points,kills,headshots,downs,revives}]` | todos | pantalla final |
| `msg` | `text` | solo pid | aviso genérico |

---------------------------------------------------------------------------------------------------

## 5. Servidor (responsable: SERVIDOR)

### 5.1 `server/index.js`
- `node server/index.js [--port 3000] [--dev]` (también `PORT` y `DEV=1` por entorno).
- Servidor HTTP estático (sin Express) con tipos MIME correctos (`.js` → `text/javascript`), protección contra
  path traversal, `Cache-Control: no-cache`. Rutas: sección 0.
- WebSocket (`ws`) en el mismo puerto. Máximo 4 jugadores (`kick` con motivo si está llena).
- Al arrancar imprime en consola las URLs LAN (todas las IPv4 no internas) y la guía corta
  ("Comparte esta dirección con tus amigos: http://192.168.x.x:3000").
- `start-server.bat` en la raíz: instala dependencias si falta `node_modules` y ejecuta `node server/index.js`.

### 5.2 `server/game.js` — clase `Game`
- Tick fijo a 20 Hz (`setInterval` 50 ms, dt medido y limitado a 0.1 s).
- Mantiene `gs` y una bandera `dirty`; envía `gs` como máximo 10 veces/s cuando está sucia.
- Envía `snap` a 20 Hz durante `playing`.
- Gestiona: lobby (listo/anfitrión/inicio), conexión/desconexión (si se va el anfitrión, el siguiente es anfitrión;
  si todos se van, volver al lobby), entrada a mitad de partida (estado `dead` → reaparece en la próxima ronda con 500 puntos).
- Posición de cada jugador: la última recibida por `st` (confía en el cliente, pero ignora saltos > 3 m por mensaje salvo
  tras `respawn`). `cur` se valida contra el tamaño del inventario.
- Salud: regeneración `PLAYER.regenRate` tras `PLAYER.regenDelay` sin daño.
- Economía y reglas de las secciones 2 y 4.3. Enviar `deny` con motivo cuando no se puede comprar.
- Daño a zombis (desde `fire`, `boom`, `melee`) → delega en `ZombieManager.damage(...)`.
  - Bala: `dmg = def.dmg × partMult(def, part) × falloff(def, dist) × (Double Tap ? 2 : 1)`; Insta-Kill → mata.
    Validar que el jugador tenga el arma `{k:w, up}` (o `w='m1911'` si está caído). Ignorar distancias > 150.
  - Puntos por disparo: +10 por cada zombi alcanzado que no murió en ese disparo; al matar: cabeza 100, cuerpo 60 (piernas cuentan como cuerpo).
  - `special:'fire'` (Hades): el zombi arde 3 s (150 de daño por segundo, bandera `ZF.BURNING`).
  - Explosión (`boom`): daño directo `projectile.direct` a `direct` + daño de área `splashDmg × (1 − 0.7·d/r)` a los zombis en radio
    `projectile.splash` (granada: `GRENADE.damage` y `GRENADE.radius`). Los supervivientes de una explosión tienen 30% de
    volverse reptantes (`ZF.CRAWLER`). Validar: granada solo si el jugador lanzó una (`nade`) en los últimos 6 s y no la detonó aún;
    proyectiles solo si tiene el arma. Las explosiones no dañan a los jugadores.
  - Cuerpo a cuerpo: el zombi debe estar a ≤ `MELEE.range + 1` m; daño `MELEE.knifeDamage` o `bowieDamage`; baja = 130 puntos.
    Con escudo (`shield:true`, el jugador debe tener escudo): `SHIELD.bashDamage`, empuje `SHIELD.knockback` (estado STUN 0.6 s),
    desgaste `bashSelfDamage` por zombi; baja = 130 puntos.
- Daño a jugadores (lo pide ZombieManager con `game.damagePlayer(pid, amount, zombie)`):
  - Escudo en las manos (`PF.SHIELD_OUT`) y zombi dentro de ±60° del frente del jugador → el escudo absorbe (`shield.hp -= amount`).
  - Escudo en la espalda y zombi dentro de ±60° de la espalda → absorbe igual.
  - Si el escudo llega a 0: `shield = null`, evento `shieldBreak`.
  - Si no absorbe: `hp -= amount`; con `hp <= 0` → caído.
- Caído/reanimación/desangrado/auto-reanimación/fin de partida: sección 2. Al caer, si se tenía Mule Kick y 3 armas, se pierde la 3.ª.
  Al desangrarse se pierden armas, escudo y ventajas (se conservan los puntos). Al reaparecer: M1911, 2 granadas, 100 de salud.
- Fin de partida: `phase = 'gameover'`, evento `gameover`; a los 15 s vuelve al lobby (reinicia todo el estado de la partida,
  conserva jugadores conectados con `ready=false`).
- Potenciadores: al morir un zombi (no por nuke), si `dropsThisRound < 4` y `random < 0.03`: aparece en la posición del zombi
  (si estaba fuera o cruzando, en la celda interior de su ventana). Tipo aleatorio distinto del anterior (sin `firesale` si la caja
  se está mudando). Duran 30 s. Se recogen a ≤ 1.3 m de un jugador vivo. Efectos:
  `maxammo` (granadas = 4 y evento `pu` que hace a los clientes recargar todo), `instakill`/`doublepoints` (30 s),
  `nuke` (mata a todos los zombis vivos sin dar puntos por bajas, +400 a cada jugador; cuentan para la ronda),
  `carpenter` (todas las ventanas a 6 tablas, +200 a cada jugador), `firesale` (30 s, todas las ubicaciones de la caja a 10 puntos, sin osito).
- Caja: sección 2 y 3. Arma aleatoria ponderada de `BOX_POOL`, excluyendo las que el usuario ya lleva (misma `k`).
  Al tomarla: si hay hueco (2 o 3 con Mule Kick) se añade; si no, reemplaza el arma de `cur`. Evento `give` al jugador.
  Osito: nunca en liquidación; slot `teddy` durante `BOX.teddyTime` → `off`, se elige nueva ubicación ≠ actual,
  slot nuevo `arriving` durante `BOX.arriveTime` → `idle`. `uses` vuelve a 0. Durante la liquidación todos los slots `off`
  pasan a `idle`; al terminar, los que no son la ubicación principal vuelven a `off` cuando estén libres.
- Pack-a-Punch: se quita el arma de la mano del inventario (puede quedar vacío), `working` 4.5 s → `ready` 15 s → se entrega
  mejorada (misma lógica de hueco/reemplazo que la caja) o se pierde.
- Escudo: piezas compartidas; construcción manteniendo F en la mesa 3 s (progreso en `gs.shield.buildUntil`); luego cada jugador
  sin escudo puede tomar uno (`shield = { hp: SHIELD.hp }`).
- Ventajas: Juggernog → `maxHp = 250` y `hp = 250`. Al perder Juggernog `maxHp = 100`.
  Quick Revive en solitario: cuesta 500; tras 3 usos la máquina deja de vender.
- Estadísticas por jugador: kills, headshots, downs, revives.

### 5.3 `server/zombies.js` — clase `ZombieManager`
API que usa `Game`:
```js
new ZombieManager(game)
update(dt)                         // IA, aparición, rondas
startGame()                        // prepara la ronda 1 (roundState 'pre', roundUntil = now + ROUND.firstDelay)
reset()                            // borra zombis y rondas (vuelta al lobby)
damage(zid, amount, pid, info)     // info: { part, kind: 'bullet'|'explosion'|'melee'|'shield'|'fire'|'nuke', weapon, upgraded,
                                   //         instakill: bool, special, knockFrom:{x,z} }
                                   // → { killed: bool, existed: bool }
killAll(kind)                      // nuke
knockback(zid, fromX, fromZ, dist) // empuje del escudo
snapshot()                         // array para `snap.z`
aliveCount()
list()                             // zombis vivos (para potenciadores y validaciones)
```
Callbacks que llama en `Game`:
```js
game.onZombieKilled(z, pid, info)       // puntos, estadísticas, potenciadores, evento zdie, zLeft--
game.damagePlayer(pid, amount, z)       // golpe que conecta
game.targets()                          // [{ pid, x, z }] jugadores vivos (no caídos ni muertos)
game.onRoundStart(round) / game.onRoundEnd(round)   // Game difunde eventos, reaparece a los muertos, repone granadas (+2, máx. 4)
game.setBoards(win, n, pid|null)        // cambia gs.windows[win] y difunde `board`
game.broadcastEvent(obj) / game.markDirty()
```
Reglas:
- Rondas: `roundState` 'pre' → 'active' (spawnea `zombiesForRound(round, jugadores)`) → cuando `zLeft == 0` → 'intermission'
  (`ROUND.intermission` s) → siguiente ronda. Vida: `zombieHealth(round)`. Velocidad por zombi según `zombieSpeedChances`.
  Aparición: uno cada `max(ZOMBIE.minSpawnDelay, ZOMBIE.firstSpawnDelay × 0.95^(ronda−1))` s, sin superar `ZOMBIE.maxAlive` vivos.
- Selección de ventana: ventanas de zonas abiertas; elegir al azar entre las 4 más cercanas (distancia de camino) a algún jugador.
- Estados: `outside` (camina por el callejón hasta la celda `tear`; si hay otro zombi en la ventana, espera en el callejón),
  `tearing` (arranca 1 tabla por `ZOMBIE.tearTime`, llamando a `game.setBoards`), `climbing` (cruza en `ZOMBIE.climbTime`
  desde `tear` hasta `land` pasando por la ventana; anim CLIMB), `inside` (persigue), `attacking`, `stunned`.
  Mientras hay tablas, un zombi en `tearing` puede golpear a un jugador que esté en la celda `land` (a través de la ventana).
- Persecución: campo de flujo (BFS multi-origen 8-direcciones sin cortar esquinas) desde las celdas de los jugadores objetivo,
  sobre celdas `solidForZombieInside == false` (con `gs.doors`). Recalcular cada 0.25 s o cuando un jugador cambie de celda
  o se abra una puerta. Cada zombi va hacia la celda vecina de menor distancia; si hay línea de visión directa con el objetivo
  y está a < 4 m, va directo. Separación entre zombis (radio 0.75). Movimiento con `moveCircle` y `solidForZombieInside`.
- Ataque: si el jugador objetivo está a ≤ `ZOMBIE.attackRange` → anim ATTACK; a los `attackWindup` s comprueba de nuevo el rango
  (+0.35 m de tolerancia) y llama a `game.damagePlayer`; cooldown `attackCooldown`. Difundir `zatk`.
- Sin objetivos (todos caídos): deambular despacio.
- Atascado: si un zombi `inside` no reduce su distancia de camino en `ZOMBIE.stuckRespawnTime` s, se elimina y vuelve a la cola
  de aparición (no cuenta como baja). También si está a > 45 m de camino de todos los jugadores durante 10 s.
- Snapshot por zombi: `[id, x, z, rot, anim, flags, yOff]`; `yOff` negativo durante RISE (no se usa en este mapa, siempre 0).

### 5.4 `tools/bot-test.js`
Script que conecta N bots (por defecto 2) por WebSocket, envía `hello`, el primero envía `start`, se mueven por la Terminal
enviando `st`, disparan a los zombis del snapshot (`fire` con impactos en la cabeza a los que estén a < 15 m), reconstruyen,
compran la puerta A cuando pueden, y registran rondas, bajas y errores. Debe poder ejecutar ~3 minutos sin excepciones en el servidor.
`node tools/bot-test.js --bots 2 --seconds 120 --url ws://localhost:3000`.

### 5.5 Modo desarrollo (`--dev`)
Comandos por chat: `/points N`, `/round N` (mata a todos y salta a la ronda N), `/power`, `/give KEY [up]`, `/god` (invulnerable),
`/killall`, `/pu TYPE` (aparece delante del jugador), `/parts` (todas las piezas), `/doors` (abre todas), `/perk KEY`.
El cliente muestra una marca "DEV" si `welcome.dev`.

---------------------------------------------------------------------------------------------------

## 6. Cliente — arquitectura

### 6.1 `ctx` (creado en `main.js`, se pasa a todos los constructores)
```js
ctx = {
  THREE, renderer, scene, camera,         // camera: PerspectiveCamera(fov=settings.fov, near 0.05, far 250)
  events,                                 // EventBus
  net, input, settings,
  selfId: null,
  gs: null,                               // último gs
  get self() { return this.gs && this.gs.players[this.selfId] || null },
  dev: false,
  time: 0,                                // segundos de reloj de render
  player, interaction, world, entities, effects, weapons, hud, menus, audio,   // se asignan en main.js
}
```
`settings` (persistido en `localStorage` 'zlan.settings'): `{ name, color, sensitivity: 1.0, fov: 75, volume: 0.8, music: 0.5, quality: 'high'|'low', invertY: false, brightness: 1.0 }`
(`brightness` multiplica la exposición base del renderer, 0.5–2).
`window.game = ctx` para depurar.

### 6.2 `EventBus` (`js/eventbus.js`)
```js
on(name, fn) → función para desuscribirse;  off(name, fn);  emit(name, payload)
```
Eventos que emite el núcleo:
- `'welcome'` `{ id, host, gs, lan, dev }`
- `'gs'` `{ gs, prev }` (después de actualizar `ctx.gs`; `prev` puede ser null)
- `'phase'` `{ phase, prev }` cuando cambia `gs.phase`
- `'ev:<nombre>'` con el objeto del evento del servidor (p. ej. `'ev:zdie'`)
- `'local:damage'` `{ amount, fromX, fromZ }` cuando llega `zatk` con `pid = yo` y `hit`
- `'local:respawn'` `{ x, z, yaw }`
- `'settings'` `settings` cuando cambian
Otros módulos pueden emitir eventos propios con prefijo de su módulo (`'weapons:fired'`, etc.).

### 6.3 Bucle principal (`main.js`)
Orden por frame (dt limitado a 0.05 s):
```
player.update(dt) → interaction.update(dt) → weapons.update(dt) → entities.update(dt) → world.update(dt)
→ effects.update(dt) → hud.update(dt) → audio.update(dt) → render → input.endFrame()
```
Render: `renderer.autoClear=false; renderer.clear(); renderer.render(scene, camera); renderer.clearDepth();
renderer.render(weapons.vmScene, weapons.vmCamera);` (el arma en primera persona nunca atraviesa paredes).
Envío de `st` a 20 Hz mientras `phase === 'playing'`. `ping` cada 2 s.
Flujo: pantalla de título (`menus.showMain`) → conectar → `hello` → lobby (`menus.showLobby`) → al pasar a `playing`:
ocultar menús, pedir pointer lock, `player.spawn(...)` con `PLAYER_SPAWNS[self.spawn]` → al `gameover`: `menus.showGameOver` → lobby.
El mundo (`world.build()`) se construye una sola vez, justo después de crear `World` y antes de conectar (el mapa es estático);
se ve de fondo en el título y en el lobby con la cámara orbitando lentamente sobre la calle (lo hace `main.js` mientras `phase !== 'playing'`).
`?debug=1` en la URL: permite jugar sin pointer lock (mirar con arrastrar del ratón) y muestra FPS.

`index.html` contiene exactamente estos contenedores (además del import map y `<link rel="stylesheet" href="/css/style.css">`):
```html
<div id="app"></div>      <!-- main.js añade aquí el canvas del renderer -->
<div id="hud"></div>      <!-- HUD lo rellena; pointer-events: none salvo el chat -->
<div id="menus"></div>    <!-- Menus lo rellena -->
<script type="module" src="/js/main.js"></script>
```
Orden de construcción en `main.js`: `Audio → Effects → World → EntityManager → WeaponSystem → PlayerController → Interaction → HUD → Menus`
(todos reciben `ctx`; cada uno se asigna a `ctx` antes de construir el siguiente). Ningún constructor debe depender de que `ctx.gs`
exista: el estado llega después. Todos los módulos deben tolerar `ctx.gs === null` y `ctx.self === null` en `update`.

**Idempotencia**: World, EntityManager, WeaponSystem y HUD deben derivar su estado visual del `gs` actual (por ejemplo, una puerta
se ve si NO está en `gs.doors`; las tablas visibles = `gs.windows[i]`), de modo que volver al lobby y empezar otra partida
funcione sin recargar la página. Los eventos solo disparan animaciones/sonidos.

### 6.4 `Net` (`js/net.js`)
```js
connect(url?) → Promise           // por defecto ws://location.host
send(obj)
serverNow() → ms                  // reloj del servidor estimado (offset de pong/gs, suavizado)
rtt                               // ms
sample(renderTime) → { zombies: Map<id,{x,z,rot,anim,flags,yOff}>, players: Map<id,{x,y,z,yaw,pitch,flags,w,up}> }
                                  // interpola entre los 2 snapshots que rodean renderTime (ángulos por el camino corto);
                                  // si falta el siguiente, extrapola como máx. 100 ms. renderTime = serverNow() − INTERP_DELAY_MS
connected
```

### 6.5 `Input` (`js/input.js`)
Acciones y teclas por defecto:
`forward` W, `back` S, `left` A, `right` D, `sprint` Shift, `crouch` C/Ctrl, `jump` Espacio, `fire` clic izq., `ads` clic der.,
`reload` R, `use` F, `melee` V, `grenade` G, `shield` Q, `flashlight` L, `weapon1` 1, `weapon2` 2, `weapon3` 3, `nextWeapon` rueda abajo,
`prevWeapon` rueda arriba, `scoreboard` Tab, `chat` T o Enter, `pause` Esc.
```js
isDown(action) → bool;  pressed(action) → bool (flanco en este frame);  released(action) → bool
consumeMouse() → { dx, dy }       // píxeles acumulados desde el último frame
locked → bool;  requestLock();  exitLock()
enabled                           // false mientras hay menú o chat abierto: isDown/pressed devuelven false
endFrame()
```
Evitar el menú contextual del clic derecho. Tab no debe cambiar el foco.

### 6.6 `PlayerController` (`js/player.js`)
```js
spawn(x, z, yaw)
update(dt)
position → THREE.Vector3 (pies);  eye → THREE.Vector3;  yaw;  pitch
velocity → THREE.Vector3;  onGround;  isSprinting;  isCrouching;  isMoving;  speed01 (0..1 respecto a la velocidad de correr)
flags() → bits PF (combina los suyos con weapons: ADS, SHIELD_OUT, RELOADING, DRINKING; y FLASHLIGHT si ctx.flashlightOn)
addRecoil(pitchRad, yawRad)       // retroceso (se recupera parcialmente)
shake(intensity, seconds)
adsZoom, adsAmount                // los fija WeaponSystem cada frame; FOV = settings.fov / lerp(1, adsZoom, adsAmount)
moveMult                          // lo fija WeaponSystem (moveMult del arma, ADS, bebiendo)
stamina01
```
- Movimiento con aceleración suave, `moveCircle` + `solidForPlayer(x, z, ctx.gs.doors)`. Salto/gravedad (solo visual, sin plataformas).
- Sprint con estamina (`PLAYER.sprintDuration`, ×2 con Stamin-Up; velocidad ×1.07 con Stamin-Up). No se puede correr apuntando,
  recargando (sí se puede, pero cancela ADS) ni caído.
- Estado `down`: cámara a `PLAYER.downEyeHeight`, velocidad `PLAYER.downSpeed`, ligera inclinación.
- Estado `dead`: modo espectador: cámara en tercera persona orbitando a un compañero vivo (clic para cambiar), sin colisión.
- Balanceo de cabeza al caminar, inclinación al moverse lateralmente, sonido de pasos (`audio.play('footstep')` cada paso).
- Mirar: `settings.sensitivity × 0.0022` rad/píxel, `invertY`.

### 6.7 `Interaction` (`js/interaction.js`)
Cada frame busca el interactuable más cercano de `INTERACTABLES` (distancia XZ a `(it.x, it.z)` ≤ `it.range`) y, para puertas y
armas de pared, que el jugador lo esté mirando (ángulo < 70° entre la vista y el objetivo). Añade caídos cercanos (`revive:PID`).
Calcula el texto (tabla siguiente) y llama a `hud.setPrompt(texto|null)`.
- `use` (pulsación F): envía `{t:'use', id}`. Pre-chequeo local de puntos: si no alcanza, `audio.play('deny')` y `hud.message`.
- `hold` (mantener F): al empezar envía `{t:'hold', id, on:true}`; al soltar, alejarse o cambiar de objetivo, `on:false`.
  Barra de progreso: `hud.setProgress(0..1|null)` (reanimar: desde `gs.players[target].reviveUntil`; construir: `gs.shield.buildUntil`;
  reconstruir: ciclo local de `REPAIR_TIME`).
- No hay interacción si el jugador está caído o muerto, ni mientras bebe una ventaja.

| Interactuable | Condición | Texto |
|---|---|---|
| door | cerrada | `Pulsa F para abrir la puerta [Costo: 750]` / `Pulsa F para despejar los escombros [Costo: 750]` |
| wallbuy | no la tiene | `Pulsa F para comprar M14 [Costo: 500]` |
| wallbuy | la tiene | `Pulsa F para comprar munición [Costo: 250]` (mejorada: `munición mejorada [Costo: 4500]`) |
| wallbuy bowie | no lo tiene | `Pulsa F para comprar el Cuchillo Bowie [Costo: 3000]` |
| perk | sin luz | `Se requiere electricidad` |
| perk | no la tiene | `Pulsa F para comprar Juggernog [Costo: 2500]` (si ya tiene 4: `Solo puedes tener 4 ventajas`) |
| power | apagada | `Pulsa F para activar la electricidad` |
| box | slot idle | `Pulsa F para abrir la Caja Misteriosa [Costo: 950]` (10 en liquidación) |
| box | ready y es tuyo | `Pulsa F para tomar Ray Gun` |
| pap | sin luz | `Se requiere electricidad` |
| pap | idle y arma mejorable en mano | `Pulsa F para mejorar tu arma [Costo: 5000]` |
| pap | ready y es tuyo | `Pulsa F para tomar Porter's X2 Ray Gun` |
| part | no recogida | `Pulsa F para recoger: Puerta de auto` |
| bench | faltan piezas | `Faltan piezas del escudo (1/3)` |
| bench | piezas completas | `Mantén F para construir el Escudo Antidisturbios` |
| bench | construido y no tienes | `Pulsa F para tomar el Escudo Antidisturbios` |
| window | < 6 tablas | `Mantén F para reconstruir la barricada` |
| revive | compañero caído | `Mantén F para reanimar a Max` |

### 6.8 `World` (`js/world/level.js`)
```js
constructor(ctx);  build();  update(dt)
```
- Construye toda la geometría a partir de `shared/map.js` (suelos por zona, muros por celda con caras visibles, techos interiores,
  vallas de callejón, props con modelos reconocibles, ventanas con marco y 6 tablas, puertas/escombros con cartel de precio,
  dibujos de tiza de las armas de pared, máquinas de ventajas, Pack-a-Punch, palanca, mesa de trabajo, 4 ubicaciones de caja,
  piezas del escudo, cielo nocturno con luna, niebla, luces).
- Reacciona al estado (`'gs'`) y eventos (`ev:door`, `ev:power`, `ev:board`, `ev:boxOpen`, `ev:boxTeddy`, `ev:boxMove`,
  `ev:papStart`, `ev:papReady`, `ev:perk`, `ev:part`, `ev:built`, `ev:pu`, `ev:puSpawn`) animando: puertas que se abren
  (deslizan/escombros que desaparecen) y dejan de verse, tablas que saltan/vuelven, caja (tapa, armas girando con
  `createWeaponMesh`, osito, rayo de luz azul, vuelo), PaP (arma que entra y sale con camuflaje), luces al activar la electricidad
  (máquinas se iluminan, fluorescentes), potenciadores girando/brillando (verde) y parpadeando al final, piezas del escudo.
- Reproduce los sonidos de su dominio con `ctx.audio.play(...)` y el locutor con `ctx.audio.announce(...)` en `ev:pu`.
- Rendimiento: fusionar geometría estática por material (`BufferGeometryUtils.mergeGeometries`), ≤ 8 luces dinámicas
  (resto con materiales emisivos y sprites aditivos), sin sombras en `quality:'low'`.

### 6.8b Linterna (`js/world/flashlight.js`)
Tecla L (acción `flashlight`). `SpotLight` hijo de la cámara, siempre en la escena (apagada = intensidad 0, así no cambia
el número de luces ni se recompilan shaders). Publica `ctx.flashlightOn`; el jugador lo envía como `PF.FLASHLIGHT` (512)
y `PlayerModel` dibuja un cono aditivo en los jugadores remotos. Se apaga en el lobby y en modo espectador.

### 6.9 `EntityManager` (`js/entities/entities.js`) y `Effects` (`js/entities/effects.js`)
```js
// EntityManager
constructor(ctx);  update(dt)
getZombieTargets() → [{ id, x, z, rot, yOff, crawler, anim }]   // posición RENDERIZADA (para disparar)
getZombie(id) → { id, x, z, group(THREE.Object3D) } | null
getPlayerVisual(pid) → { position: THREE.Vector3 (pies), head: THREE.Vector3 } | null
hitReact(id, part)                // reacción visual inmediata a un impacto local (sacudida del modelo)
reset()                           // borra zombis, cadáveres y jugadores remotos (nueva partida)
```
- Usa `ctx.net.sample(ctx.net.serverNow() − INTERP_DELAY_MS)` para posicionar zombis y jugadores remotos (el local no se dibuja).
- Zombi: humanoide procedural (cabeza a 1.62 m, torso, brazos extendidos, piernas) que coincide con `ZOMBIE_HITBOX`; variantes
  de ropa/piel; ojos brillantes naranja/amarillo; animaciones por código `ZA` (caminar arrastrando, correr, sprint, atacar,
  arrancar tablas, trepar, reptar, aturdido); `ZF.BURNING` → fuego; `ZF.CRAWLER` → sin piernas y reptando.
- Muertes (`ev:zdie`): `head` → la cabeza revienta; `explode`/`nuke` → despedazado/ennegrecido; resto → cae; los cadáveres se
  hunden en el suelo a los 5 s. Reacción a impactos (`ev:zhit` y los locales vía `hitReact(id, part)`).
- Gruñidos aleatorios 3D (`audio.play('zombie_groan', {pos})`), sonido de golpe (`ev:zatk`) y de muerte.
- Jugadores remotos: soldado procedural teñido con su color, arma en las manos (`createWeaponMesh(w, up)`), poses por banderas
  (agachado, correr, apuntar, caído en el suelo), escudo delante o en la espalda (`createShieldMesh()`), nombre flotante.
```js
// Effects
constructor(ctx);  update(dt)
blood(pos, dir?, amount=1)          // pos: THREE.Vector3
gib(pos, amount=1)                  // trozos que salen volando
spark(pos, normal)                  // impacto en metal/pared
dust(pos, normal)                   // impacto en madera/suelo
decal(pos, normal)                  // marca de bala (máx. ~60, reciclar)
explosion(pos, radius, kind)        // kind: 'frag'|'raygun'|'raygun_up'|'launcher'|'ms'
tracer(from, to, color=0xffe0a0)
muzzleLight(pos)                    // destello de luz breve (para disparos de otros)
flash(pos, color, size)             // destello aditivo genérico (potenciadores, PaP, electricidad)
fire(object3D, seconds)             // llamas pegadas a un objeto
```
Effects escucha `ev:boom` y dibuja la explosión (y pide `audio.play('explosion', {pos})`).

### 6.10 Armas: `WeaponSystem` (`js/weapons/weaponSystem.js`) y `models.js`
```js
// models.js
createWeaponMesh(key, upgraded=false) → THREE.Group   // en metros, cañón hacia −Z, origen en la empuñadura; con camuflaje PaP si upgraded
createShieldMesh() → THREE.Group                      // escudo antidisturbios (~0.6×0.9 m), frente hacia −Z
createTeddyMesh() → THREE.Group                       // osito de la caja
updateCamo(dt)                                        // anima el material de camuflaje compartido (lo llama WeaponSystem.update)
```
```js
// WeaponSystem
constructor(ctx);  update(dt);  reset()
vmScene, vmCamera                                     // escena y cámara del arma en primera persona
current → { slot, key, up, def, mag, reserve } | null
adsAmount (0..1);  isReloading;  isShieldOut;  isDrinking
hudInfo() → { name, key, up, mag, reserve, grenades, shieldHp, shieldOut, lowAmmo, noAmmo, melee }
spreadDeg() → dispersión actual (para la cruz)
```
- Munición llevada en el cliente por clave de arma (`k`). Al aparecer una arma nueva en `self.weapons` o con `ev:give` → llena.
  `ev:ammo` / `ev:pu` maxammo → reserva al máximo. Si un arma desaparece del inventario (PaP, caer) se descarta su munición.
- Disparo: modos semi/auto/burst/pump/bolt con `fireInterval(def, doubleTap)`; dispersión según cadera/ADS/movimiento/salto;
  por perdigón: `raycastMap` (con `gs.doors`) + `rayZombie` contra `entities.getZombieTargets()` hasta `pen` zombis antes de la pared;
  enviar un `fire` por disparo; efectos locales inmediatos (fogonazo, trazador, sangre, chispas/polvo + marca, `hud.hitmarker`,
  `entities.hitReact`). Retroceso con `player.addRecoil`. Sonido con `audio.weapon(def.sound, { upgraded })`.
- Proyectiles (`def.projectile`): simular en `projectiles.js` con segmentos contra `raycastMap` y `rayZombie`; al impactar el propio
  jugador envía `boom`. Los de otros (`ev:proj`, `ev:nade`) se simulan solo como visual (sin enviar nada).
- Granada (G): animación de lanzar, física con rebotes (`GRENADE`), `nade` al lanzar y `boom` al explotar tras la mecha.
- Cuchillo (V): animación, a los 0.12 s golpea al zombi más cercano dentro de `MELEE.range` y `MELEE.arcDeg` → `melee`.
- Escudo (Q): si `self.shield`, alterna escudo en las manos (no se dispara; clic o V = golpe con escudo → `melee {shield:true}`).
- Recarga (R, o automática al vaciar si hay reserva), cancelable al cambiar de arma; Speed Cola ×0.5.
- ADS con clic derecho (mueve el arma al centro con mira de hierro; francotiradores: `hud.setScope(true)` al 100%).
- Cambio de arma (1/2/3, rueda) con animación de 0.4 s. Correr pone el arma en diagonal y no permite disparar.
- Caído: fuerza la mejor pistola del inventario (clase 'pistol' o 'wonder') o una M1911 temporal (8/24); sin cuchillo, granadas ni escudo.
  Al ser reanimado vuelve al arma anterior.
- Beber ventaja (`ev:perk` con pid = yo): 1.6 s con botella del color de la ventaja, sin disparar (`isDrinking`).
- Sin armas (tras un PaP de la única arma): solo manos y cuchillo.
- `vmCamera`: FOV 60 fijo, sin moverse; el grupo del arma se anima (balanceo al caminar, inercia del ratón, retroceso, recarga,
  cambio, correr). Fogonazo con sprite aditivo + `PointLight` breve en la escena principal.
- Otros jugadores (`ev:fire`): trazador desde su posición y sonido 3D.

### 6.11 `HUD` (`js/ui/hud.js`) y `Menus` (`js/ui/menus.js`)
```js
// HUD (DOM sobre el canvas, contenedor #hud)
constructor(ctx);  update(dt)
setPrompt(text|null);  setProgress(v|null);  hitmarker(kind: 'hit'|'kill'|'head');  damage(fromX, fromZ)
message(text, seconds=2.5);  setScope(on);  showScoreboard(on)
```
Estilo BO2: número de ronda abajo a la izquierda en **rojo tipo tiza** (marcas de conteo I–IIII para rondas 1–5, luego números),
animación al cambiar (parpadeo blanco→rojo); puntos de cada jugador en su color con "+N" flotantes; iconos de ventajas (círculos
de color con siglas); munición abajo a la derecha (nombre del arma, `8 / 80`, granadas); potenciadores activos abajo al centro con
parpadeo al final; cruz dinámica; hitmarker; viñeta roja según salud y salpicaduras; indicadores de dirección de daño; aviso
"Pulsa R para recargar"; barra de desangrado/reanimación; iconos sobre compañeros caídos (proyección 3D→pantalla); tabla de
puntuación con Tab; chat (T/Enter); mira telescópica; mensajes centrales; contador de zombis restantes en modo dev.
Reacciona a: `ev:pts`, `ev:roundStart`, `ev:roundEnd` (con `audio.music(...)`), `ev:pu`, `ev:down`, `ev:revived`, `ev:bleedout`,
`ev:chat`, `ev:deny`, `ev:msg`, `local:damage`.
```js
// Menus (DOM, contenedor #menus)
constructor(ctx)
showMain(onJoin(name, color))   // título "ZOMBIES", nombre del mapa, nombre del jugador, color, controles, botón Unirse
showLobby()                     // se actualiza solo con 'gs': jugadores, listo, botón Iniciar (anfitrión), URLs LAN, chat
showGameOver(data)              // "FIN DE LA PARTIDA — Sobreviviste N rondas", tabla de estadísticas
togglePause()                   // Esc: Continuar, Ajustes, Controles, Salir al lobby (desconecta y recarga)
showSettings()                  // sensibilidad, FOV, volumen, música, calidad, invertir Y (aplica y guarda, emite 'settings')
hideAll();  isOpen → bool
```
### 6.12 `Audio` (`js/audio.js`)
```js
constructor(ctx);  unlock();  update(dt)                        // update coloca el listener en la cámara
play(name, { pos, volume=1, rate=1, loop=false } = {}) → { stop() }
weapon(soundKey, { pos, upgraded=false, volume=1 })          // disparos por arquetipo (pistol, revolver, smg, rifle, burst, lmg,
                                                               // shotgun, sniper, raygun, raygun2, launcher)
music(name)                                                   // 'round_start','round_end','game_over','box','pap','perk:KEY','lobby','power'
announce(text)                                                // speechSynthesis (voz grave, en inglés si existe) + efecto
setVolumes(master, music)
```
Todo sintetizado con WebAudio (osciladores, ruido, filtros, envolventes, reverb por convolución generada). Nombres para `play`:
`footstep, jump, land, hurt, heartbeat, down, revive, deny, buy, reload_out, reload_in, reload_bolt, pump, empty, switch, knife,
knife_hit, bash, hit_flesh, headshot, hitmarker, kill, door_open, debris, board_tear, board_repair, box_open, box_close, teddy_laugh,
box_whoosh, perk_drink, perk_burp, pap_work, pap_ready, power_on, powerup_spawn, powerup_grab, powerup_loop, nuke,
zombie_groan, zombie_attack, zombie_die, zombie_step, explosion, grenade_throw, grenade_bounce, pin, shield_hit, shield_break,
part_pickup, build, chat, ui_click, ui_hover, round_tick`.
Los sonidos con `pos` se espacializan (PannerNode HRTF, distancia 1–40 m). Las melodías son **originales** (no copiar música de BO).

---------------------------------------------------------------------------------------------------

## 7. Estilo visual

Noche, niebla azul oscura, luna. Interiores cálidos y tenues con luces parpadeantes; con la electricidad, fluorescentes fríos.
Tiza blanca para las armas de pared (silueta del arma + nombre + precio). Máquinas de ventajas altas, de colores, con letrero
emisivo y zumbido. Pack-a-Punch con brillo púrpura/azul. Caja de madera con signos "?" y rayo de luz azul hacia el cielo.
Autobús azul y blanco en la calle (guiño a TranZit). Sangre roja oscura. Potenciadores verdes brillantes girando.
Objetivo de rendimiento: 60 FPS en un portátil medio con 24 zombis y 4 jugadores.

## 8. Controles (pantalla de ayuda)

WASD mover · Ratón mirar · Clic izq. disparar · Clic der. apuntar · Shift correr · C/Ctrl agacharse · Espacio saltar ·
R recargar · F usar/comprar (mantener para reconstruir, construir y reanimar) · V cuchillo · G granada · Q escudo · L linterna ·
1/2/3 o rueda cambiar de arma · Tab puntuaciones · T/Enter chat · Esc pausa.
