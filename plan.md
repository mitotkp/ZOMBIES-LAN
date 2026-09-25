# ZOMBIES-LAN — Plan para continuar

## Estado actual (2026-09-25)

- El repositorio `mitotkp/ZOMBIES-LAN` estaba **vacío** (sin commits).
- El código del proyecto está en el equipo local del usuario:
  `C:\Users\LAPTOP\Downloads\PROYECTOS\ZOMBIES_LAN`
- La sesión de Claude corre en un contenedor en la nube y **no tiene acceso a
  discos locales de Windows**, así que no pudo copiar esos archivos. El primer
  paso (subir el código) hay que hacerlo desde el propio PC.

## Paso 1 — Subir el proyecto local al repo (PRIMORDIAL)

Abrir PowerShell (o Git Bash) en el PC y ejecutar:

```powershell
cd "C:\Users\LAPTOP\Downloads\PROYECTOS\ZOMBIES_LAN"

# Solo si la carpeta aún no es un repo git
git init
git branch -M main

# Traer este plan.md (y lo que haya en el repo remoto)
git remote add origin https://github.com/mitotkp/ZOMBIES-LAN.git
git fetch origin
git merge origin/claude/affectionate-edison-hb53ej --allow-unrelated-histories

# Revisar qué se va a subir (ver sección .gitignore abajo)
git status

git add .
git commit -m "Subir proyecto ZOMBIES_LAN"
git push -u origin main
```

Si `git remote add` dice que `origin` ya existe, usar:
`git remote set-url origin https://github.com/mitotkp/ZOMBIES-LAN.git`

Alternativa sin consola: GitHub Desktop → *File › Add local repository* →
seleccionar la carpeta → *Publish/Push*. O bien, en github.com →
*Add file › Upload files* y arrastrar la carpeta (límite 100 archivos / 25 MB
por archivo por subida).

### Antes del commit: `.gitignore`

No subir builds, dependencias ni secretos. Según la tecnología del proyecto:

| Tecnología | Ignorar |
|---|---|
| Unity | `Library/ Temp/ Obj/ Build/ Builds/ Logs/ UserSettings/ *.csproj *.sln` |
| Godot | `.godot/ .import/ export_presets.cfg` (si tiene credenciales) |
| Node.js | `node_modules/ dist/ .env` |
| Python | `__pycache__/ .venv/ venv/ *.pyc .env` |
| C#/.NET | `bin/ obj/ .vs/` |
| General | `*.log`, archivos `.env` con claves, `.DS_Store`, `Thumbs.db` |

Plantillas oficiales: https://github.com/github/gitignore

Archivos binarios grandes (>50 MB: audio, modelos, texturas) → usar Git LFS
(`git lfs install` y `git lfs track "*.wav"` etc.).

## Paso 2 — Retomar con Claude

Una vez el código esté en `main`, abrir una nueva sesión de Claude Code sobre
este repo y pedir:

> "Lee el proyecto y completa las secciones *Arquitectura*, *Qué funciona* y
> *Tareas pendientes* de plan.md, y continúa con la primera tarea."

## Secciones a completar cuando el código esté en el repo

### Arquitectura
_(pendiente: motor/lenguaje, cómo funciona la red LAN — host/cliente,
protocolo, sincronización de zombis y jugadores)_

### Cómo ejecutar
_(pendiente: requisitos, comando/escena para lanzar host y cliente)_

### Qué funciona
_(pendiente)_

### Tareas pendientes (orden sugerido para un juego de zombis en LAN)
1. Verificar que el proyecto compila/arranca tras clonarlo desde GitHub.
2. Conexión LAN estable: descubrimiento de partidas, unirse, desconexión limpia.
3. Autoridad del servidor para zombis (IA, spawn, daño) y sincronización a clientes.
4. Jugadores: movimiento, disparo, vida, muerte/reaparición sincronizados.
5. Bucle de juego: oleadas/rondas, puntuación, condición de derrota.
6. UI: menú principal (host/unirse), HUD, pantalla de fin de partida.
7. Pruebas con 2+ equipos en la misma red; medir latencia y corregir desincronías.
8. Build distribuible y README con instrucciones.
