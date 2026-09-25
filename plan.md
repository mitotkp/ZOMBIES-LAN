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
| Servidor | `server/index.js, game.js, zombies.js, nav.js` | ✅ Hecho. `bot-test` 60 s: 0 errores, rondas, bajas y tablas funcionan |
| Herramientas | `tools/validate-map.js, bot-test.js`, `start-server.bat` | ✅ Hecho |
| Núcleo cliente | `public/index.html`, `js/main.js, net.js, input.js, player.js, interaction.js, eventbus.js, fallback.js` | ✅ Hecho (`fallback.js` sustituye con stubs cualquier módulo que falte) |
| Armas | `js/weapons/*` | ✅ Hecho |
| Entidades | `js/entities/*` | ✅ Hecho |
| UI / Audio | `js/ui/*`, `js/audio.js`, `css/style.css` | ✅ Hecho |
| **Mundo** | `js/world/` | ⚠️ **INCOMPLETO** (ver abajo) |
| README | `README.md` | ❌ Falta (SPEC §0 lo pide, en español) |

### Qué falta en `public/js/world/`

Ya existen los auxiliares `kit.js` (lotes estáticos, materiales, utilidades), `textures.js`, `levelgeo.js` (geometría
del mapa), `lighting.js`, `sky.js` y `props.js` (props estáticos + `createInteractives`).

Faltan los archivos que dan vida al mundo. Sin ellos, `main.js` usa un stub y **no se ve el mapa**:

1. **`level.js`**: clase `World` (`constructor(ctx)`, `build()`, `update(dt)`); ver SPEC §6.8. Crea `root`, `StaticBatch`,
   `MaterialLib`, `SignSet`, `Flames`, `Sky` y `Lighting`, llama a `buildLevelGeometry`, `buildStaticProps` y
   `createInteractives`, y reparte `gs` y eventos a los interactivos.
2. **`barriers.js`**: `Doors` (puertas y escombros con cartel de precio; se abren y desaparecen) y `Windows` (marco + 6 tablas
   según `gs.windows[i]`, animación al arrancar o reparar).
3. **`machines.js`**: `PerkMachines`, `PackAPunch`, `PowerSwitch`, `Workbench` (con las piezas del escudo).
4. **`mysterybox.js`**: `MysteryBoxes` (4 ubicaciones, tapa, armas girando, osito, rayo de luz, mudanza).
5. **Potenciadores** en el suelo (verdes, girando, parpadean al final), dentro de `level.js` o en un `powerups.js` aparte.

Interfaz que `props.js` espera de cada interactivo: `new C(world, B)`, donde `world` expone `root`, `signs`, `flames`, `ctx`,
`mats`… y `B` es el `StaticBatch`/`Placer`. Revisa `kit.js` y `props.js` para ver los nombres exactos.

## Tareas pendientes (en orden)

1. [ ] Implementar el módulo Mundo que falta (lista de arriba).
2. [ ] Abrir el cliente en el navegador (`?debug=1`) y comprobar que no hay errores en la consola; revisar el rendimiento (objetivo: 60 FPS).
3. [ ] Partida completa de prueba: puertas, caja, PaP, ventajas, escudo, potenciadores, caer y reanimar, fin de partida y vuelta al lobby.
4. [ ] Revisar el zombi que se queda atascado al final de la ronda 1 en `bot-test` (quedan=1 durante más de 30 s; puede que sea
   que los bots no lo alcanzan, pero hay que confirmar que `stuckRespawnTime` lo recicla).
5. [ ] Escribir `README.md` en español (instalación, cómo jugar en LAN, firewall de Windows, controles).
6. [ ] Probar con 2 o más PCs reales en la misma red.
7. [ ] Opcional: quitar `node_modules/` del repo y añadir `.gitignore` (`start-server.bat` ya ejecuta `npm install` si falta).
   Se dejó dentro para poder jugar sin internet.

## Registro de sesiones

- **2026-09-25**: se subió el proyecto y se revisó. Servidor verificado con bots. Se detectó que falta el módulo Mundo.
  (Las entradas siguientes, debajo.)
