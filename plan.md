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
5. [ ] **Probar en un PC real con GPU**: FPS (objetivo 60 con 24 zombis), sombras y calidad baja, sonido
   (el audio no se pudo oír en headless) y pointer lock.
6. [ ] Partida completa a mano: comprar armas de pared y ventajas, beber, Mule Kick, escudo en la mano y en la espalda,
   reanimar, liquidación y osito de la caja (con `/points` y `--dev` es rápido).
7. [ ] Probar con 2 o más PCs reales en la misma red (firewall de Windows y latencia).
8. [ ] Ajustes visuales opcionales: el interior es bastante oscuro antes de activar la electricidad (revisar
   `lighting.js` / `toneMappingExposure` en `main.js`) y la puerta metálica se ve muy negra.
9. [ ] Opcional: quitar `node_modules/` del repo y añadir `.gitignore` (`start-server.bat` ya ejecuta `npm install`).
   Se dejó dentro para poder jugar sin internet.
10. [x] Revisado: el zombi que quedaba en la ronda 1 de `bot-test` no está atascado. Los bots reparan la ventana
   que él arranca una y otra vez; en 150 s las rondas avanzan con normalidad.

## Registro de sesiones

- **2026-09-25 (1)**: se subió el proyecto y se revisó. Servidor verificado con bots. Se detectó que faltaba el módulo Mundo.
- **2026-09-25 (2)**: se implementó el módulo Mundo completo, se corrigió el bug de `props.js`, se escribió el README y
  se arregló el solapamiento del HUD. Probado en navegador headless.
