# ZOMBIES-LAN — Plan para continuar

Shooter cooperativo en primera persona, inspirado en el modo Zombies de Black Ops 2.
Servidor **Node.js autoritativo** + cliente **navegador con Three.js**, para 1–4 jugadores en LAN.
Todo el arte y el audio son procedurales. El contrato completo entre módulos está en **`SPEC.md`**:
es la referencia principal, léelo antes de tocar código.

## Cómo ejecutar

```bash
npm install                 # node_modules ya viene en el repo (three 0.186.1, ws 8.21.3)
npm start                   # servidor en http://localhost:3000 (Windows: doble clic en start-server.bat)
node server/index.js --dev  # modo desarrollo: comandos /points, /round, /power, /give... en el chat
npm run validate-map        # valida shared/map.js
npm run bots -- --bots 2 --seconds 120 --url ws://localhost:3000   # prueba headless del servidor
```

Los amigos abren `http://IP-DEL-ANFITRION:3000`. Con `?debug=1` en la URL se puede jugar sin pointer lock y se ven los FPS.

## Estado por módulo (revisado 2026-09-25)

| Módulo | Archivos | Estado |
|---|---|---|
| Compartido | `shared/*.js` | ✅ Hecho. `validate-map` → "Mapa OK" |
| Servidor | `server/index.js, game.js, zombies.js, nav.js` | ✅ Hecho. `bot-test` 150 s: llega a la ronda 4, 0 errores |
| Herramientas | `tools/validate-map.js, bot-test.js`, `start-server.bat` | ✅ Hecho |
| Núcleo cliente | `public/index.html`, `js/main.js, net.js, input.js, player.js, interaction.js, eventbus.js, fallback.js` | ✅ Hecho |
| Armas | `js/weapons/*` | ✅ Hecho |
| Entidades | `js/entities/*` | ✅ Hecho |
| UI / Audio | `js/ui/*`, `js/audio.js`, `css/style.css` | ✅ Hecho |
| Mundo | `js/world/*` | ✅ Hecho (se completó en esta sesión, ver abajo) |
| README | `README.md` | ✅ Hecho |

### Módulo Mundo (`public/js/world/`)

- `level.js`: clase `World`. Crea la niebla y el cielo, fusiona la geometría estática (`StaticBatch`), añade props
  e iluminación y reparte `gs` (método `sync(gs, prev, live)`) y los eventos `ev:*` (`onEvent(name, e)`) a cada
  interactivo; en cada frame llama a `update(dt, t, gs)`. También reproduce el sonido de compra (`ev:buy` propio),
  la voz de los potenciadores y la música de la electricidad.
- `barriers.js`: `Doors` (puerta metálica que sube o escombros que se hunden, con placa de precio) y `Windows`
  (6 tablas; salen volando al arrancarlas y vuelven al repararlas).
- `machines.js`: `PerkMachines` (se iluminan con la electricidad y suena el jingle al comprar), `PackAPunch`
  (el arma entra, se mejora y sale flotando), `PowerSwitch` (palanca animada) y `Workbench` (piezas en el suelo
  y sobre la mesa, chispas al construir, escudo terminado).
- `mysterybox.js`: `MysteryBoxes` (4 ubicaciones con palé fijo, tapa, armas girando cada vez más lento, arma
  ofrecida que se hunde, osito, la caja sale volando y cae en la nueva ubicación, rayo azul y luz).
- `powerups.js`: `Powerups` (símbolo verde que gira, halo, charco de luz y parpadeo al final).
- Todo deriva de `gs` (idempotente): se probó que al volver al lobby se reinician puertas, luz, piezas y potenciadores.

Verificado en Chromium headless (SwiftShader) con un bot por WebSocket: sin errores de consola; se vieron
funcionar las puertas, las ventanas, la caja (giro y arma), el PaP (listo con el arma mejorada), las máquinas,
la palanca, la mesa y los potenciadores.
Nota para futuras pruebas headless: el render va a ~4 FPS y `dt` se limita a 0,05 s, así que las animaciones
van lentas, y el servidor rechaza saltos de más de 3 m entre mensajes `st`. Hay que mover al bot en pasos pequeños
partiendo de la posición de su evento `respawn`.

## Tareas pendientes (en orden)

1. [x] Implementar el módulo Mundo.
2. [x] `README.md` en español.
3. [x] Arreglar el HUD: la capa "Observando a" (`main.js`) se solapaba con el aviso "Te has desangrado" (`hud.js`).
4. [x] Arreglar `props.js`: `bottle()` recibía `r()` (un número) en lugar del generador `r` y rompía los props.
5. [x] Iluminación: se subió la luz ambiente y la de cada zona, la exposición base (1.3) y se añadió el ajuste **Brillo**
   (Ajustes, 50–200 %) y una **linterna** con la tecla L (los compañeros ven el haz).
6. [x] Barra de salud en el HUD (abajo a la izquierda), con la marca del límite de regeneración (60 %).
7. [x] Curas: venda, antídoto y botiquín (tecla H), armarios de primeros auxilios y curas que sueltan los zombis.
8. [x] Infección: 25 % por golpe; pierde vida poco a poco (1 → 4 por segundo) hasta curarse o caer; viñeta verde.
9. [x] Armas cuerpo a cuerpo de pared: bate con clavos, machete y hacha de bombero (además del Bowie).
10. [x] Contador de ronda en el HUD (arriba en el centro): tiempo de la ronda en curso y cuenta atrás de la preparación
   ("Siguiente ronda en 8" + "Ronda 1 superada en 0:20"), con aviso sonoro en los 3 últimos segundos.
11. [x] Revisado: el zombi que quedaba en la ronda 1 de `bot-test` no está atascado. Los bots reparan la ventana
   que él arranca una y otra vez; en 150 s las rondas avanzan con normalidad.
12. [ ] **Probar en un PC real con GPU**: FPS (objetivo 60 con 24 zombis), sombras y calidad baja, sonido
   (el audio no se pudo oír en headless) y pointer lock.
13. [ ] Partida completa a mano: comprar armas de pared y ventajas, beber, Mule Kick, escudo en la mano y en la espalda,
   reanimar, liquidación y osito de la caja (con `/points` y `--dev` es rápido).
14. [ ] Probar con 2 o más PCs reales en la misma red (firewall de Windows y latencia).
15. [ ] Probar el equilibrio en partidas reales: probabilidad de infección, límite de regeneración (60 %), precios de las
    curas y daño de las armas cuerpo a cuerpo (todo está en `shared/constants.js` y `MELEE_WEAPONS` en `shared/weapons.js`).
16. [ ] Opcional: que los demás jugadores vean el arma cuerpo a cuerpo y la animación de curarse en el modelo en tercera persona.
17. [ ] Opcional: quitar `node_modules/` del repo y añadir `.gitignore` (`start-server.bat` ya ejecuta `npm install`).
   Se dejó dentro para poder jugar sin internet.

## Mapa procedural (propuesta para una próxima sesión: convivirá con "Pueblo Olvidado" como opción en la sala)

Es posible, pero es el cambio más grande que queda: hoy todo el juego lee un mapa fijo de `shared/map.js`
(servidor, colisiones, navegación de los zombis y cliente), y parte del decorado del cliente tiene coordenadas
escritas a mano para "Pueblo Olvidado" (`levelgeo.js` FACADES, las luces de `lighting.js` y el decorado de `props.js`).

Enfoque propuesto:
1. `shared/map.js` → `buildMap(seed)`: devuelve las mismas estructuras de ahora (ZONES, DOORS, WINDOWS, PROPS, WALLBUYS,
   PERK_MACHINES, PAP_MACHINE, POWER_SWITCH, WORKBENCH, BOX_LOCATIONS, SHIELD_PARTS, PLAYER_SPAWNS, cuadrícula e
   INTERACTABLES) dentro de un objeto de mapa. "Pueblo Olvidado" pasa a ser un mapa fijo más.
2. Generador (con semilla, para que servidor y clientes obtengan el mismo mapa):
   - 5–8 salas de 10–16 celdas colocadas en una rejilla (o BSP), cada una con un estilo (interior/calle/almacén/planta...).
   - Conexiones: árbol de expansión desde la sala inicial, más alguna puerta extra para crear bucles; precio de las puertas
     creciente según la distancia a la sala inicial (750 → 1250).
   - Ventanas en los muros exteriores (2–3 por sala) con su callejón de 3×3.
   - Colocación contra las paredes: armas de pared (las más baratas cerca del inicio), 6 ventajas repartidas, electricidad
     y Pack-a-Punch en salas lejanas, 4 ubicaciones de la caja, 3 piezas del escudo en salas distintas, mesa y obstáculos.
   - Validación automática (reutilizar `tools/validate-map.js`): todo alcanzable, interactuables accesibles y ventanas válidas.
3. Servidor: elige la semilla al iniciar la partida (o el anfitrión escoge "Pueblo Olvidado"/"Aleatorio" en la sala) y la
   envía en `gs.map`. Hay que regenerar la navegación.
4. Cliente: `World` se reconstruye cuando cambia `gs.map`. Hay que generalizar las fachadas, luces y decorado para que se
   generen por sala (cada estilo de sala sabe decorarse a sí mismo).
5. Pruebas: `bot-test` con varias semillas; `validate-map --seed N`.

Esfuerzo estimado: grande (varias sesiones). Recomendación: hacerlo por fases (1 → 2 con validación → 3 → 4).

## Registro de sesiones

- **2026-09-25 (1)**: se subió el proyecto y se revisó. Servidor verificado con bots. Se detectó que faltaba el módulo Mundo.
- **2026-09-25 (2)**: se implementó el módulo Mundo completo, se corrigió el bug de `props.js`, se escribió el README y
  se arregló el solapamiento del HUD. Probado en navegador headless.
- **2026-09-25 (3)**: tras la prueba del usuario ("se ve muy oscuro"): más luz, ajuste de Brillo y linterna (L). Propuesta
  de mapa procedural en este documento.
- **2026-09-25 (4)**: barra de salud, curas (H), infección y armas cuerpo a cuerpo (bate, machete, hacha).
- **2026-09-25 (5)**: contador de ronda y de tiempo de preparación en el HUD.
