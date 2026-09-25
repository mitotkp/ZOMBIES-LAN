# ZOMBIES LAN

Shooter cooperativo en primera persona para **1 a 4 jugadores en red local**, inspirado en el modo Zombies
de *Call of Duty: Black Ops 2*. Solo hace falta un navegador: uno de los jugadores hace de anfitrión con Node.js
y los demás se conectan desde su PC con el navegador.

Mapa: **Pueblo Olvidado**, con Terminal, Calle, Bar, Almacén y Planta Eléctrica. Tiene caja misteriosa,
Pack-a-Punch, 6 Perk-a-Colas, armas de pared, escudo construible y potenciadores.
Todo el arte y el sonido se generan por código, así que no hace falta internet para jugar.

## Requisitos

- **Node.js 20 o superior** en el PC del anfitrión ([nodejs.org](https://nodejs.org)).
- Un navegador moderno con WebGL (Chrome, Edge o Firefox) en cada jugador.
- Todos los equipos en la **misma red** (wifi o cable).

## Iniciar el servidor (anfitrión)

**Windows:** doble clic en `start-server.bat`. La primera vez instala las dependencias si faltan.

**Cualquier sistema:**

```bash
npm install      # solo la primera vez (node_modules ya viene incluido en el repositorio)
npm start        # servidor en el puerto 3000
```

La consola muestra la dirección que tienes que compartir, por ejemplo:

```
Comparte esta dirección con tus amigos: http://192.168.1.35:3000
```

- El anfitrión también juega: abre `http://localhost:3000` en su navegador.
- Los amigos abren la dirección `http://IP-DEL-ANFITRION:3000`.
- Otro puerto: `node server/index.js --port 4000` (o `PORT=4000 npm start`).

### Firewall de Windows

Si tus amigos no pueden conectarse, permite Node.js en el firewall. Suele salir un aviso la primera vez:
marca **"Redes privadas"** y pulsa *Permitir acceso*. Si no salió, ve a *Panel de control → Firewall de Windows
Defender → Permitir una aplicación* y activa `Node.js JavaScript Runtime` en redes privadas. Comprueba también
que la red wifi esté configurada como **privada** y no como pública.

## Cómo se juega

1. Escribe tu nombre, elige un color y pulsa **Unirse a la partida**.
2. En la sala, los jugadores marcan *Listo* y el anfitrión pulsa **Iniciar partida**.
3. Empiezas en la Terminal con la M1911 y 500 puntos. Los zombis entran por las ventanas con barricada.
4. Gana puntos disparando a los zombis y reconstruyendo las tablas. Con esos puntos abre puertas, compra armas
   y ventajas, activa la electricidad y mejora tu arma en el Pack-a-Punch.
5. Si caes, un compañero puede reanimarte. Si caen todos, se acaba la partida.

### Salud, infección y curas

- Un golpe de zombi normal quita 25 de salud: aguantas 4 golpes (10 con Juggernog).
- La barra de **salud** está abajo a la izquierda. Sin curas solo se regenera hasta el 60 % (la marca blanca de la barra).
- Un golpe de zombi puede **infectarte**: la barra se pone verde y pierdes vida poco a poco hasta curarte o caer.
- Pulsa **H** para curarte. Se usa la cura más adecuada: el antídoto si estás infectado, el botiquín si te queda poca vida
  y, si no, una venda.
  - **Venda**: +35 de salud (máx. 5). **Antídoto**: cura la infección (máx. 2). **Botiquín**: salud completa y cura la infección (máx. 1).
  - Se compran en los armarios con una cruz roja (Terminal: vendas, Bar: antídotos, Almacén: botiquines) y los zombis
    a veces las sueltan al morir: pasa por encima para recogerlas.

### Zombis especiales

Según avanzan las rondas aparecen, cada vez con más frecuencia:

- **Corredor** (desde la ronda 3): delgado y con ojos rojos; corre siempre, pero aguanta menos.
- **Explosivo** (desde la ronda 5): hinchado y con pústulas que brillan. Si se te acerca enciende la mecha (pita y parpadea en rojo)
  y estalla; también estalla al morir. Mátalo de lejos: la explosión hace daño a los jugadores cercanos, pero también
  a los zombis de alrededor.
- **Tanque** (desde la ronda 8): enorme, con mucha vida y golpes brutales. Se anuncia con un rugido. No se deja empujar
  y destroza las barricadas en un momento. Da 500 puntos extra y siempre suelta un potenciador.

### Jefes

Desde la **ronda 5** cada ronda trae un jefe (dos desde la ronda 20). Cuanto más alta es la ronda, más vida y más daño
tienen. Su barra de vida aparece arriba. La Muerte Instantánea no les afecta. Al derrotarlo, el que lo remata gana
1000 puntos, el resto del equipo 300, y siempre suelta un potenciador y un botiquín.

| Jefe | Cómo es | Consejo |
|---|---|---|
| **El Carnicero** | Enorme, con delantal y cuchilla | Carga en línea recta si estás lejos: apártate y dispárale cuando se estampe |
| **La Madre Plaga** | Hinchada y verde | Su aura tóxica daña e infecta: no te acerques y lleva antídotos |
| **El Nigromante** | Alto, encapuchado, con bastón | Invoca zombis cada pocos segundos: mátalo primero |
| **El Acorazado** | Placas de acero | Solo la cabeza recibe todo el daño; golpea el suelo en área |
| **El Espectro** | Pálido y translúcido | A ratos se vuelve casi invisible, más rápido y resistente |

### Armas cuerpo a cuerpo

Además del Cuchillo Bowie, en las paredes hay (dibujos de tiza) un **bate con clavos** (Terminal, golpea a varios y los
empuja), un **machete** (Almacén) y un **hacha de bombero** (Planta Eléctrica). Sustituyen al cuchillo en la tecla V.

Si lo ves muy oscuro, sube el **Brillo** en *Ajustes* (menú de pausa con Esc) o enciende la linterna con **L**.

### Controles

| Acción | Tecla |
|---|---|
| Moverse / mirar | WASD / ratón |
| Disparar / apuntar | Clic izquierdo / clic derecho |
| Correr / agacharse / saltar | Shift / C o Ctrl / Espacio |
| Recargar | R |
| Usar / comprar | F (mantener para reconstruir, construir y reanimar) |
| Cuchillo / granada / escudo | V / G / Q |
| Linterna | L |
| Curarse (venda, antídoto o botiquín) | H (otra vez para cancelar) |
| Cambiar de arma | 1, 2, 3 o rueda del ratón |
| Puntuaciones / chat / pausa | Tab / T o Enter / Esc |

## Para desarrolladores

- `SPEC.md`: especificación técnica completa (protocolo, estado de juego y API de cada módulo).
- `plan.md`: estado actual del proyecto y tareas pendientes.
- `node server/index.js --dev`: modo desarrollo. En el chat puedes usar `/help`, `/points N`, `/round N`,
  `/power`, `/give ARMA [up]`, `/god`, `/killall`, `/pu TIPO`, `/parts`, `/doors`, `/perk VENTAJA`,
  `/meds`, `/infect`, `/item TIPO` y `/spawn TIPO` (runner, bomber, tank, butcher, plague, necro, armored, specter).
- `http://localhost:3000/?debug=1`: permite jugar sin capturar el ratón y muestra los FPS.
- `npm run validate-map`: comprueba el mapa.
- `npm run bots -- --bots 2 --seconds 120 --url ws://localhost:3000`: prueba automática del servidor con bots.

Estructura: `server/` (servidor autoritativo: reglas, zombis, rondas), `shared/` (mapa, armas, constantes y
protocolo, compartidos con el cliente) y `public/` (cliente Three.js sin empaquetador: módulos ES nativos).
