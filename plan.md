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
11. [x] Música: canción del menú (tranquila pero amenazante) y canción de la partida (agresiva, volumen moderado, se
   apaga entre rondas y baja durante los jingles). Niveles medidos: menú ≈ −30 dBFS; partida ≈ −29 dBFS, unos 11 dB por
   debajo de los efectos. Se ajusta con `gain` en `SONGS` (`public/js/audio.js`).
12. [x] Zombis especiales: corredor (ronda 3+), explosivo (ronda 5+, mecha y explosión en área) y tanque (ronda 8+,
   jefe con 1,5× de tamaño). Probabilidades y valores en `ZOMBIE_TYPES` (`shared/constants.js`).
13. [x] Daño de los zombis a 25 (4 golpes sin Juggernog). Jefes desde la ronda 5 (Carnicero, Madre Plaga, Nigromante,
   Acorazado y Espectro) con barra de vida y escalado por ronda (`BOSS_RULES` y `ZOMBIE_TYPES` en `shared/constants.js`).
14. [x] Modelos menos cuadrados: cajas con cantos redondeados en armas (`B()` en `models.js`), manos, botas y equipo;
   más lados en extremidades, torso y cabeza (`limbGeo` en `procgen.js`); dedos en cápsula; brazos en primera persona
   redondeados. Triángulos: zombi ~6.700, jugador ~11.000, arma ~3.000 (si en algún PC baja el rendimiento, reducir
   `radial` en `limbGeo` o los segmentos de `B()`).
15. [x] Manos en primera persona articuladas (palma, 4 dedos de 2 falanges y pulgar) que se cierran sobre la empuñadura,
   se curvan al sujetar objetos y se relajan sin arma; dedos en las manos del modelo de tercera persona.
   Animaciones propias para la venda (vendarse el antebrazo) y el botiquín (maletín + jeringuilla); el antídoto se bebe.
16. [x] Agarres coherentes en primera persona: la muñeca es una articulación (el antebrazo `fore` apunta al codo y la
   mano gira libre). `_placeArm(arm, mano, codo, orient, grip)` orienta la mano con `{x: dir}` (eje del puño, p. ej. la
   aguja) o `{y: dir}` (dorso) y hace coincidir un punto de agarre de la mano con el objeto. El maletín va en la palma
   izquierda (palma arriba), la jeringuilla y la botella dentro del puño derecho y el rollo de venda entre los dedos;
   la aguja entra justo en la muñeca izquierda.
17. [x] Agarre de las armas: cada modelo guarda su empuñadura (`userData.grip` / `gripDir`, que `addGrip` rellena
   solo; las armas cuerpo a cuerpo lo definen a mano). El puño derecho la rodea con el meñique hacia la base y el
   dorso hacia fuera; la izquierda sujeta el guardamanos desde abajo (palma arriba, dedos por el lado derecho),
   envuelve la derecha en las pistolas o agarra la empuñadura vertical (`leftGripDir`, lanzagranadas).
   `_orient(o, obj, x, y, k)` mezcla la orientación exacta respecto al objeto con la del antebrazo (k).
18. [x] Sala de pruebas en `/test/` (`public/test/index.html` + `public/js/testroom.js`), sin enlace desde el menú y sin
   servidor de juego: visor del arma en primera persona con el mapa de fondo, vista lateral y libre (OrbitControls),
   todas las acciones del ViewModel, congelar la acción en un punto, y visor de modelos (zombis, jefes, jugador).
   Útil para revisar agarres y animaciones: si se añade una acción nueva al ViewModel, añadirla también a `ACTIONS`.
19. [x] Codo articulado en primera persona: hombros fijos (`SHOULDER_R/L`) y codo por IK de 2 huesos (`_ik`), con
   antebrazo (`FORE_LEN`) y brazo (`UPPER_LEN`) de longitud fija; las antiguas posiciones de codo son ahora el
   polo hacia el que se dobla. Las poses solo indican dónde va la mano (y su orientación).
20. [x] Linterna del modelo del jugador: linterna táctica montada en el arma (bajo el cañón en las cortas, en el
   lateral en las largas) o en el chaleco sin arma, con lente, halo y haz.
21. [x] Equilibrio de golpes fuertes (`BALANCE` en constants): un golpe de jefe/tanque quita como mucho el 40 % de la
   salud máxima, 0,7 s de invulnerabilidad tras un golpe fuerte, y en solitario −30 % de daño y −20 % de vida.
   El crecimiento de daño de los jefes baja (`dmgPerRound` 0,05, `dmgMax` 2,2).
22. [x] Mano del arma en primera persona: la mano derecha se orienta del todo según la empuñadura (`GUN_BACK`, dorso
   hacia fuera y atrás, k = 1) para que la palma la envuelva por detrás y no quede el lomo a la vista; hombros más
   atrás y fuera, brazo más largo y polos de codo abiertos para que los brazos entren desde las esquinas.
   Guantes marrones en lugar de negros para que la mano no se confunda con el arma a oscuras.
23. [x] Agarre de pistola legible: el hueco del puño (`GRIP_GUN`) está delante de la palma, en la curva de los dedos,
   así la palma tapa la empuñadura por detrás y los dedos asoman rodeándola; índice estirado hacia el gatillo
   (`setCurl(c, idx)`); pistolas a la cadera con una mano (la izquierda solo al recargar o apuntar), algo más
   alejadas y giradas; muñeca del guante más fina.
24. [x] Sin atravesar la empuñadura: la palma se apoya en su cara derecha, los nudillos quedan por delante de su
   cara frontal (`GRIP_GUN`) y las segundas falanges apenas se cierran (`setCurl(c, idx, mid)`), así los dedos
   cruzan por delante sin meterse en ella; el agarre sube bajo la corredera (`addGrip`, 2,6 cm sobre el centro).
   Comprobado midiendo las puntas de los dedos en coordenadas del arma.
25. [x] Modelos nuevos de especiales y jefes (`public/js/entities/bossModels.js`): cada tipo monta su anatomía sobre
   el esqueleto del zombi (mismos huesos, así siguen funcionando poses, impactos y muertes) con torsos paramétricos
   (`torsoFn`), cabezas de monstruo con dientes y mandíbula animada (`monsterHead`), brazos, manos con garras, ropa,
   armas y accesorios. Cada tipo aporta `pose` (retoques de la pose), `update` (piezas animadas) y `onAbility`
   (evento `ev:bossAbility`: carga, golpe al suelo, invocación).
   - Carnicero: saco en la cabeza, delantal, cuchilla y gancho; carga con la cuchilla en alto.
   - Madre Plaga: cuerpo deforme con bubones emisivos, tumor, sacos de huevos, bilis y nube tóxica; respira.
   - Nigromante: flota; capucha con calavera, bastón que se mantiene vertical, runas orbitando; invoca alzándolo.
   - Acorazado: armadura de chatarra por capas, cadenas, casco de barrotes; carga y descarga el golpe al suelo.
   - Espectro: esquelético, pelo que tapa la cara, brazos largos, jirones que ondean; espasmos de cabeza.
   - Tanque: gorila con puños enormes y huesos saliendo; galope apoyado en los puños.
   - Explosivo: barriga con venas incandescentes (emissiveMap) que parpadean con la mecha. Corredor: costillas.
   Todos los zombis tienen espasmos de cabeza aleatorios. La elevación de los que flotan es pequeña para no salirse
   de la caja de impacto. `/test/` → Modelos tiene el botón «Habilidad del jefe».
26. [x] Zombi común rehecho: hombros caídos, variantes de torso (barriga / demacrado), brazos con deltoides y
   antebrazo musculado, manos más grandes con dos falanges y uñas negras, dientes de verdad arriba y abajo,
   orejas, ojos más pequeños y hundidos, pies con tobillo (se quedan planos en el suelo). Dos conjuntos nuevos
   (vestido con pelo largo y bata de hospital con piernas desnudas) y decoración aleatoria en `decorateCommon`
   (bossModels.js): faldones rasgados, costillas al aire pegadas al torso, tripas colgando que se balancean,
   sin mandíbula (con la lengua), antebrazo arrancado y un ojo reventado.
   Animación: cuatro formas de andar (`gaitStyle`: arrastra los pies, cojo que arrastra una pierna rígida,
   acechador encorvado, rígido que se balancea), brazo roto que cuelga (`brokenArm`), reposo que mira alrededor
   y cambia el peso, puntera que baja al levantar el pie, brazos y cabeza con inercia (suavizado por canal `RATE`),
   brazos que se agitan con los impactos, y tres ataques (zarpazo, agarrón con mordisco, martillazo).
27. [x] Animaciones de los jefes: ataque propio sincronizado con el `windup` del servidor (`atkPhases`, `hitTime`,
   `attackPeriod`): tajo de cuchilla (Carnicero), agarrón y mordisco (Plaga), estocada con el bastón
   (Nigromante), gancho con el guantelete (Acorazado), zarpazo doble con chillido (Espectro) y mazazo con los
   dos puños (Tanque). Rugido al aparecer y cada 8-19 s (`makeRoar`: rugido, golpes en el pecho del Tanque,
   chillido del Espectro), resistencia a los impactos (`stagger`) y zancada proporcional al tamaño.
28. [x] Idioma inglés. `public/js/i18n.js` (`tr(texto, ...args)`, `getLang`, `setLang`) con el diccionario
   `public/js/lang/en.js` (clave = texto en español, `{0}` para variables; las plantillas también traducen textos ya
   formateados que llegan del servidor, como «No tienes vendas.»). Selector en la pantalla de título y en Ajustes;
   cambiar de idioma recarga la página (en partida pide confirmación). Idioma inicial: el del navegador.
   Traducidos menús, HUD, avisos de interacción, pantallas de conexión, menús de respaldo, carteles del mapa
   (`makeSign` traduce cada línea), pizarras de armas, máquinas de ventajas y nombres de curas, jefes y potenciadores.
   El servidor sigue hablando en español (consola del anfitrión y mensajes, que traduce el cliente).
   Para añadir un texto nuevo: escribirlo con `tr('...')` y añadir la clave a `en.js`.
16. [x] Revisado: el zombi que quedaba en la ronda 1 de `bot-test` no está atascado. Los bots reparan la ventana
   que él arranca una y otra vez; en 150 s las rondas avanzan con normalidad.
17. [ ] **Probar en un PC real con GPU**: FPS (objetivo 60 con 24 zombis), sombras y calidad baja, sonido
   (el audio no se pudo oír en headless) y pointer lock.
18. [ ] Partida completa a mano: comprar armas de pared y ventajas, beber, Mule Kick, escudo en la mano y en la espalda,
   reanimar, liquidación y osito de la caja (con `/points` y `--dev` es rápido).
19. [ ] Probar con 2 o más PCs reales en la misma red (firewall de Windows y latencia).
20. [ ] Probar el equilibrio en partidas reales: probabilidad de infección, límite de regeneración (60 %), precios de las
    curas y daño de las armas cuerpo a cuerpo (todo está en `shared/constants.js` y `MELEE_WEAPONS` en `shared/weapons.js`).
21. [ ] Opcional: que los demás jugadores vean el arma cuerpo a cuerpo y la animación de curarse en el modelo en tercera persona.
22. [ ] Opcional: quitar `node_modules/` del repo y añadir `.gitignore` (`start-server.bat` ya ejecuta `npm install`).
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
- **2026-09-25 (6)**: música del menú y de la partida.
- **2026-09-25 (7)**: zombis especiales (corredor, explosivo y tanque).
- **2026-09-25 (8)**: más aguante (4 golpes) y 5 jefes por ronda desde la ronda 5.
- **2026-09-26 (9)**: modelos de personajes y armas menos cuadrados.
- **2026-09-26 (10)**: manos articuladas y animaciones de venda y botiquín.
- **2026-09-26 (11)**: muñeca articulada y agarres reales en las curas (maletín en la palma, jeringuilla en el puño).
- **2026-09-26 (12)**: agarre real de todas las armas (empuñadura en el puño, mano izquierda bajo el guardamanos).
- **2026-09-26 (13)**: sala de pruebas en `/test/`.
- **2026-09-26 (14)**: codo con IK, linterna táctica en el modelo del jugador y equilibrio de jefes en solitario.
- **2026-09-26 (15)**: mano del arma envolviendo la empuñadura, brazos desde las esquinas y guantes marrones.
- **2026-09-26 (16)**: agarre de pistola legible (puño real, índice en el gatillo, una mano a la cadera).
- **2026-09-26 (17)**: los dedos ya no atraviesan la empuñadura.
- **2026-09-26 (18)**: modelos y animaciones nuevos de jefes y zombis especiales.
- **2026-09-26 (19)**: zombi común rehecho (modelo, variantes, heridas, andares, ataques) y ataques/rugidos de los jefes.
- **2026-09-26 (20)**: idioma inglés.
- **2026-09-28: iluminación/atmósfera + arreglo de carteles tapados** (sesiones de otra rama de trabajo,
  ver los commits `Ilumina el mapa al estilo BO2...` y `Arregla el cartel de Salidas...`): atmósfera
  más sombría con acentos de color al estilo BO2 (luces de cada zona recortadas ~50 %, ambiente/luna más
  tenues, sin postprocesado — se probó con bloom/viñeta/mapa de reflejos genérico y se deshizo por verse
  mal), y un bug real de geometría en `props.js` (el marco del cartel de Salidas y el del reloj de la
  Terminal tapaban la pantalla del cartel en vez de quedar detrás; diagnosticado con un raycast).
  ⚠️ Pendiente re-aplicar en esta rama: la PR #2 de Rodrigo (`cambios-rodrigo`, perros que aturden en vez
  de dañar + arreglo de escaleras) sigue abierta en GitHub sin fusionar aquí.
- **2026-09-28: arranca la refactorización a clases (Player/Zombie/Weapon/Renderer)**. Decisiones
  tomadas con el usuario antes de programar (quedan documentadas por si hace falta revisarlas):
  BO2 como referencia de iluminación (ya aplicado, ítem de arriba); autoridad de movimiento del jugador
  pasa al SERVIDOR (hoy sigue siendo del cliente — cambio de red grande, pendiente, ver más abajo);
  `Weapon` será una jerarquía real (clase base + las armas concretas derivan de ella), no una tabla
  plana ni una clase por arma; migración incremental verificando en cada paso; se empieza por `Player`.
  - **Paso 1 (hecho): `server/entities/player.js`**, clase `Player` que envuelve `gs.players[id]` (pub)
    + `Game.pd.get(id)` (priv) — mismas referencias, no copias; el resto de `game.js` (compras, ventajas,
    caja, Pack-a-Punch, puertas...) sigue leyendo/escribiendo esos mismos objetos sin cambios. Métodos:
    `takeDamage`, `goDown`, `revive`, `applyMovementReport` (esta última sigue validando la posición que
    manda el cliente, todavía no la calcula — eso es el paso de autoridad de movimiento, aparte).
    `game.js` pasa a delegar en estos métodos desde `damagePlayer`/`_goDown`/`_revive`/`_onState`, y solo
    se encarga de lo que sigue siendo suyo de verdad: eventos de red, `markDirty`, y tocar a OTRO jugador
    (ej. `revives++` de quien reanima). `server/game.js` bajó ~60 líneas netas en el intercambio.
    Verificado: `node --check`, `validate-map`, `bot-test.js` 140 s (ronda 3, 0 errores, movimiento y
    daño a jugador ejercitados en vivo sin denegaciones ni rubber-banding), prueba aislada de la clase
    (32 aserciones: daño normal/god/invulnerable/tope de golpe fuerte/reducción en solitario/escudo que
    bloquea y se rompe/infección/caer con pérdida de puntos y ventajas/Mule Kick recorta arma/reanimar
    restaura vida e invulnerabilidad breve/movimiento acepta normal y rechaza teletransporte imposible),
    y una caída real de punta a punta en el navegador (puntos 500→475, exactamente el 5% esperado).
  - **Pendiente dentro de "Player"**: `_bleedout` (la transición a `'dead'` tras desangrarse del todo)
    todavía muta `gs.players[id]` directo con `Object.assign`, no pasa por la clase — se dejó así a
    propósito para no ampliar el primer paso; falta un método `Player.bleedOut()` más adelante.
  - **Pendiente, más grande, aparte**: autoridad de movimiento en el servidor (el cliente pasaría a
    mandar su input, no su posición; el servidor simula con la física de `shared/collision.js`; hace
    falta predicción + reconciliación en el cliente para que no se sienta con retraso en LAN). Se aborda
    después de que `Player` esté terminado, no mezclado con este paso.
  - **Paso 2 (hecho): `server/entities/zombie.js`**, clase `Zombie` que envuelve el mismo objeto de
    datos que `ZombieManager._newZombie` construye (misma referencia). Este paso se quedó corto a
    propósito, igual que Player con la autoridad de movimiento: solo migró `takeDamage` (antes
    `ZombieManager.damage`) y `die` (antes el `z.dead = true` suelto dentro de `_remove`), más dos
    ayudantes que solo usaba el daño (`bossDamageFactor`, `makeCrawler`). **Update/procesarMovimiento y
    atacar se quedan en `ZombieManager` por ahora**: `_updOutside/_updTearing/_updClimbing/_updInside/
    _updAttack` y las habilidades de los jefes dependen de recursos que son del MANAGER, no de un zombi
    en particular — el campo de flujo (una sola malla de pathfinding para los hasta 24 zombis a la vez,
    no una por zombi), la lista de objetivos del tick actual, y las funciones de colisión que cambian
    según la planta que se esté evaluando en ese instante. La clase ya guarda una referencia a `manager`
    (sin usar todavía) para cuando llegue ese paso, así no hace falta volver a tocar los 3 sitios donde
    se crea un zombi (`_spawnOne`/`_spawnDog`/`spawnBossAt`).
    `ZombieManager.damage()` bajó de ~35 líneas a una delegación de ~12; se borraron `_bossDamageFactor`
    y `_makeCrawler` (nadie más los usaba). `INSIDE_STATES` (que sí usan bastante las partes que se
    quedaron) se mudó a `zombie.js` y se importa de vuelta, para no duplicarlo.
    Verificado: `node --check`, `validate-map`, dos corridas de `bot-test.js` (ronda 3 normal —27
    bajas/9 a la cabeza en la segunda, saliendo directo desde la ronda 6 con `--round 6 --god` para
    cruzarse con más variedad de zombis y una explosión de granada real—, 0 errores en ambas), y una
    prueba aislada de la clase (29 aserciones: daño normal/letal/ya muerto/con bomba nuclear en curso,
    muerte instantánea que no afecta a jefes, armadura del Acorazado según el tipo de golpe, camuflaje
    del Espectro, invulnerabilidad del Conde hecho murciélagos, quemadura de Hades sin reiniciarse con
    su propio tic, salvarse reptante en el borde de una explosión, perder las piernas sin estar en el
    borde, un tanque nunca queda reptante, `die()`).
  - **Paso 3 (hecho): `public/js/weapons/weapon.js`**, jerarquía `Weapon` (base) -> `HitscanWeapon` /
    `ProjectileWeapon` / `MeleeWeapon`, fábrica `createWeapon(key, up)`. Cada instancia guarda su propia
    munición (`currentBullets`/`reserveBullets`), su ciclo de recarga (completa o cartucho a cartucho) y su
    autorecarga programada; `state` ('ready'|'reloading'|'empty') se calcula, no se guarda. `WeaponSystem`
    conserva el input, los modos de disparo (semi/auto/ráfaga/bombeo/cerrojo), la balística y el mundo;
    `this.ammo` (objetos planos) pasó a `this.weapons` (Map de instancias) y `this.reload/autoReloadAt`
    desaparecieron (`isReloading` ahora sale del arma activa). La M1911 temporal de "última batalla" también
    es una `Weapon` (con munición propia fija 8/24). `_interrupt()` cancela la recarga del arma saliente.
    `MeleeWeapon` existe pero NO está conectada aún a `_tryKnife/_knifeHit` (paso aparte).
    Verificado: `node --check`, `validate-map`, prueba aislada (`node --experimental-loader` para resolver
    los imports `/shared/...`; 68 aserciones) y prueba en vivo en el navegador (disparo, vaciar cargador,
    autorecarga, escopeta de bombeo con corte al disparar, cancelar al cambiar de arma, Ray Gun como
    proyectil, M1911 temporal; 0 errores de consola). `bot-test.js` NO aplica (no carga código cliente).
    Nota de pruebas: el navegador de automatización pausa `requestAnimationFrame` entre acciones y no logra
    pointer lock, así que el ciclo se condujo llamando a los métodos del `WeaponSystem` real (`window.game.weapons`).
  - **Paso 4 (hecho): `public/js/render/renderer.js`**, clase `Renderer`: fachada fina sobre
    `THREE.WebGLRenderer` (no lo reimplementa; el recorte por frustum y la ordenación ya los hace Three).
    Absorbió de `main.js`: creación/configuración del renderer, montaje del canvas, `pixelRatioFor`/`resize`,
    `applySettings` (calidad/brillo/sombras), resolución dinámica (`adaptResolution`, antes 3 variables sueltas
    en `boot`), sombras a 30 Hz (`tickShadows`) y el pase de dibujo (`render(scene, camera, overlay)`, con el
    arma en primera persona como `overlay` y `clearDepth` entre pases). Principio de solo lectura: `render`
    no cambia estado; `main.js` decide qué se dibuja (¿hay partida?, ¿muerto?). `ctx.renderer` sigue siendo
    el `WebGLRenderer` (lo usan entities/input/level); la fachada es `ctx.gfx`. Interpolación temporal de
    entidades: ya vive en `entities/`, no se movió. `main.js` bajó ~70 líneas.
    Verificado: `node --check`, recarga real (menú con órbita de cámara, partida con mundo + arma), 0 errores de
    consola, cambio de brillo/calidad por eventos `settings` (exposición 1.45→1.74, sombras y tamaño de canvas
    según calidad), resolución dinámica simulada (baja, deshace si no sirve, recupera), alternancia de sombras.
  - **Paso 5 (hecho): `MeleeWeapon` conectada al cuchillo.** Ahora tiene estado y reglas reales: enfriamiento,
    duración del golpe e instante de impacto (`trySwing/tryFire`, `update(dt)` -> `{hit}`, `cancel`), leyendo
    `meleeStats()` (el cuchillo básico solo existe en `MELEE_WEAPONS`, por eso `createWeapon('knife')` ya la
    construye y su `def` se sintetiza). `WeaponSystem` perdió `knifeT/knifeHitDone/meleeCd/knifeDur/knifeHitAt`
    (y los imports `KNIFE_DUR/KNIFE_HIT`): usa `_melee()` (instancia según `self.melee`, conserva el enfriamiento
    al cambiar de arma). Se queda en `WeaponSystem` lo del mundo: quién cae en el arco (`meleeTargets`), mensaje
    `melee`, sangre, sonido, sacudida y las condiciones cruzadas (granada/bebida). El golpe de escudo (`_tryBash`)
    no se tocó.
    Verificado: `node --check`, prueba aislada (Weapon ampliada, sección melee: stats, tiempos, hit único,
    enfriamiento, cancel) y en vivo (swing con animación 0.42 s, bloqueo por enfriamiento, segundo golpe,
    `_cancelAll`, mensaje `melee` con 1 objetivo falso delante; 0 errores de consola).
  - **Paso 6 (hecho): movimiento AUTORITATIVO en el servidor (Player).** Cambio de red: el cliente ya NO manda
    su posición; manda comandos y el servidor mueve al jugador.
    - `shared/movement.js` (nuevo, compartido): `stepMovement(estado, comando, dt, env)` es el único sitio donde
      vive la física del jugador (aceleración, correr/estamina, agacharse, deslizarse, saltar, gravedad, rampas,
      colisión, empuje suave de zombis). Sin nada del navegador/reloj/azar: mismo resultado en ambos lados.
      `quantizeCmd` redondea el comando ANTES de simular (dt en ms enteros, ejes a 2 decimales, yaw a 4) para que
      lo simulado sea exactamente lo que viaja. Comando = intención por fotograma (ejes, bits: correr/agacharse/
      saltar con sus flancos, yaw, multiplicador de velocidad `mm`).
    - Servidor: `Player.applyMoveCommands` ejecuta los comandos con el mismo `stepMovement`; `applyMovementReport`
      quedó solo para mirada/banderas/arma. Anti-trampas: **presupuesto de tiempo** (el tiempo simulado no puede
      superar el tiempo real recibido +15 %, tope 0.5 s; comandos de más se confirman pero no mueven), `seq`
      repetidos se ignoran, máx. 20 comandos por mensaje, `mm` acotado a [0.1, 1]. Se borraron las constantes de la
      validación vieja (`MAX_JUMP_MARGIN`, `RESYNC_AFTER`, `TELEPORT_GRACE`...). `Player.placeAt` recoloca
      (reaparecer/teletransporte: rehace el estado simulado) y `resetMoveSync` reinicia la numeración al reconectar.
    - Confirmación: con cada snapshot (20 Hz) el servidor manda a cada jugador `{t:'mv', seq, s}` (último comando
      atendido + estado simulado). Cliente (`public/js/player.js`): predice con el mismo paso, guarda los comandos sin
      confirmar y, si el estado del servidor difiere >2 cm de lo predicho, lo adopta y **re-simula** los pendientes;
      la diferencia se disipa como corrección visual (>1.5 m: salto directo). Cámara, balanceo, pasos y sonidos
      siguen siendo solo del cliente. `main.js` manda `c` (comandos) en vez de `p` en `st`.
    - Decisiones/limitaciones a saber: (1) el multiplicador `mm` (arma, apuntar, beber, escudo) lo declara el
      cliente y el servidor solo lo acota: el objetivo es evitar teletransportes/velocidad, no verificar el peso del
      arma; (2) el empuje de zombis lo calcula cada lado con SUS zombis (el cliente los ve ~100 ms atrás) y la
      reconciliación absorbe la diferencia; (3) `tools/bot-test.js` ahora camina mandando comandos con el mismo
      `stepMovement`, y se arregló una carrera real: los bots que se unen esperan a que el anfitrión cree la sala.
    Verificado: `node --check`, `validate-map`, prueba aislada (~30 aserciones: cuantización idempotente, pack/
    unpack, determinismo exacto, caminar/correr/saltar/muro, presupuesto de tiempo, repetidos, muerto, caído,
    basura, tope de comandos), `bot-test.js` (2 bots, ronda 2, 0 errores) y el escenario completo (compras, caja,
    Pack-a-Punch, ventajas, escudo, ventanas, ronda 6: 11/11 OK, 0 errores: depende de que la posición del servidor
    sea correcta), y en el navegador real (caminar 9 m: posición del cliente == posición del servidor, pendientes
    a 0, sin errores). **Sin probar**: latencia alta/pérdida de paquetes (solo localhost), teletransportador real
    del castillo, escaleras con reconciliación, y jugar a mano con teclado/ratón reales.
  - **Paso 7 (hecho): Zombie completo + plan de IA/físicas/horda (`server/entities/zombie.js`, `server/zombies.js`,
    `shared/pool.js`, `shared/constants.js`).** `Zombie` ahora es dueña de TODO el comportamiento de UN zombi:
    `update(dt, now)` (máquina de estados), `moveToward` ("procesar movimiento"), `startAttack/_updAttack` ("atacar"),
    `takeDamage`, `die`. `ZombieManager` conserva lo compartido (colección, campo de flujo, objetivos, colisiones,
    separación, rondas, aparición, ruido, atascos, piscina) y las habilidades de los jefes (invocan zombis y usan el
    campo de flujo); la clase le pide esos recursos por `this.manager`. `z._c` (no enumerable) es el envoltorio
    persistente: ya no se crea un `Zombie` por llamada.
    **Revisión del plan pegado por el usuario, punto por punto:**
    - *1. FSM*: hecha. Estados `outside → tearing → climbing → inside` (+ `attacking`, `stunned`) y, dentro,
      `mode`: **wander → chase** (Idle/Wander → Agro). El merodeo solo lo hacen los zombis normales recién entrados:
      se activan por **vista** (`ZOMBIE.aggro.vision` 14 m, misma planta), por **ruido** (disparo 40 m vía
      `Game._onFire`, correr 10 m vía `_onState`; `ZombieManager.noise/hearShot/hearSprint`), al ser **dañados**, o
      al agotarse su tiempo de merodeo (4–10 s desde que entran). Ese tope es a propósito: en un modo por rondas, un
      zombi que no persigue jamás atasca la ronda; la horda siempre llega. Perros, jefes, tipos especiales,
      invocados y oleadas continuas (`rush`) persiguen desde el principio. Efecto de juego: la ronda 1 dura ~10 s
      más. *Stagger/Death*: la muerte ya existía; nuevo **retroceso** = velocidad x0.6 0.3 s (cuerpo/cabeza) o x0.35
      0.6 s (piernas), solo balas/cuerpo a cuerpo, sin jefes/tanques/perros (`ZOMBIE.stagger`, `Zombie._stagger`).
      **No adoptado**: "headshot = muerte instantánea" (el daño ya escala por arma: `def.head` x1.5–x5; un headshot
      con pistola inicial no mata a un zombi de ronda 10 y así debe ser el equilibrio) — cambiarlo es decisión de diseño.
    - *2. Rapier3D*: **no aplica a la simulación de zombis y no se cambió.** Rapier existe solo en el CLIENTE
      (`public/js/physics/`: ragdolls de jugadores caídos y gibs, ya con cápsulas/bolas dinámicas). Los zombis vivos
      los simula el SERVIDOR (Node, multi-sala, autoritativo) con colisión de círculo sobre la cuadrícula
      (`moveCircle`, `resolveCircle`), campo de flujo y separación: determinista, barato para 24 zombis x N salas y
      sin riesgo de desincronía por física. Meter un motor de físicas en el servidor por cápsulas + `lockRotations`
      no aporta nada porque el círculo ya no rota ni cae. *Hitboxes*: ya existen y separadas
      (`shared/collision.js`: `ZOMBIE_HITBOX`, `rayZombie`: cabeza esférica, torso cilíndrico, piernas; multiplicador
      por arma, no un x3 fijo).
    - *3. Movimiento y animación*: velocidad variable **hecha** (`ZOMBIE.speedVariance` 0.15 → base x [0.85, 1.15]; antes
      era +-8 %). Animación sincronizada con la velocidad real: **ya lo hacía** el cliente
      (`entities.js` mide el desplazamiento real por fotograma y `ZombieModel.update` deriva el ritmo del ciclo de
      paso de `speed/zancada`) — sin cambios; el merodeo lento se ve como paso lento.
    - *4. Rendimiento*: **IA diferida** hecha: la elección de ruta (rayos + campo de flujo, lo caro) se rehace cada
      `ZOMBIE.aiInterval` = 0.25 s con azar +-20 % por zombi (`Zombie._plan`); el paso de movimiento se da cada tick
      hacia lo último decidido y el cliente ya interpola snapshots. Medido: 7 planificaciones en 40 ticks (antes 40).
      **Piscina de objetos**: `shared/pool.js` (`ObjectPool`: acquire/release/deferRelease/flush) y los datos del zombi se
      reciclan (`_blankZombie` declara todos los campos; `_newZombie` los reinicia uno a uno sin crear objetos);
      la liberación es DIFERIDA (un zombi muerto espera al siguiente tick porque eventos/puntos/explosiones aún lo
      leen). **No hecho en el cliente**: `InstancedMesh`/piscina de modelos. `ZombieModel` es un grafo procedural
      distinto por semilla (materiales propios, piezas/desmembrado que se mutan al morir y pasa a cadáver); reciclarlo
      exige un `reset()` completo que hoy no existe y un fallo se vería como zombis con miembros de otro. Lo caro
      (geometrías, texturas, materiales base) ya está compartido/cacheado en `getZombieAssets`. Queda anotado como
      trabajo aparte si el perfil lo pide.
    Verificado: `node --check`, prueba aislada previa de daño (29 aserciones, sigue OK), prueba nueva de la FSM con un
    `ZombieManager` real (~40 aserciones: velocidad variable, piscina y reinicio total de campos, cuarentena,
    merodeo → persecución por vista/ruido/tiempo/daño, no cuenta como atascado, retroceso, planificación diferida,
    ataque con windup, ventana outside→tearing→climbing→inside), y `bot-test.js`: partida normal (ronda 3), ronda 12
    con jefe/habilidades/tanques/explosivos (3 bots), castillo, y escenario completo 11/11; 0 errores en todas.
    **Sin probar**: latencia alta, partida real con teclado/ratón, ni el efecto del merodeo en el "feeling" (ajustar
    `ZOMBIE.aggro` si la ronda se siente lenta).
  - **Siguiente en la cola**: (a) probar a mano todo lo de los pasos 6-7; (b) opcional: piscina/`reset()` de `ZombieModel`
    en el cliente si el rendimiento lo pide; (c) subir a GitHub cuando `gh` tenga la sesión de `mitotkp`..