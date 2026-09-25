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
| Cambiar de arma | 1, 2, 3 o rueda del ratón |
| Puntuaciones / chat / pausa | Tab / T o Enter / Esc |

## Para desarrolladores

- `SPEC.md`: especificación técnica completa (protocolo, estado de juego y API de cada módulo).
- `plan.md`: estado actual del proyecto y tareas pendientes.
- `node server/index.js --dev`: modo desarrollo. En el chat puedes usar `/help`, `/points N`, `/round N`,
  `/power`, `/give ARMA [up]`, `/god`, `/killall`, `/pu TIPO`, `/parts`, `/doors` y `/perk VENTAJA`.
- `http://localhost:3000/?debug=1`: permite jugar sin capturar el ratón y muestra los FPS.
- `npm run validate-map`: comprueba el mapa.
- `npm run bots -- --bots 2 --seconds 120 --url ws://localhost:3000`: prueba automática del servidor con bots.

Estructura: `server/` (servidor autoritativo: reglas, zombis, rondas), `shared/` (mapa, armas, constantes y
protocolo, compartidos con el cliente) y `public/` (cliente Three.js sin empaquetador: módulos ES nativos).
