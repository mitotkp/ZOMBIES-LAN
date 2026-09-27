#!/usr/bin/env bash
# Genera las voces del locutor de potenciadores (estilo "Fatality": grave, con cuerpo y mucha reverberación).
# Requisitos: edge-tts (pip install edge-tts) y ffmpeg.
# Uso: tools/gen-announcer.sh        → escribe public/audio/announcer/<tipo>.mp3
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=public/audio/announcer
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

VOICE=${VOICE:-en-US-ChristopherNeural}
TTS=${TTS:-edge-tts}

# tipo|texto (los tipos coinciden con POWERUPS.types de shared/constants.js)
LINES=(
  "maxammo|Max Ammo!"
  "instakill|Insta-Kill!"
  "doublepoints|Double Points!"
  "nuke|Kaboom!"
  "carpenter|Carpenter!"
  "firesale|Fire Sale!"
)

# Capa principal bajada ~4 semitonos (formantes incluidos: voz de gigante), capa sub una octava abajo,
# saturación suave, eco de sala grande y normalización.
FILTER='[0:a]aformat=sample_rates=48000:channel_layouts=mono,asplit=2[a][b];
[a]asetrate=48000*0.78,aresample=48000,atempo=1.12,equalizer=f=160:t=q:w=1:g=5[main];
[b]asetrate=48000*0.5,aresample=48000,atempo=1.75,lowpass=f=900,volume=0.55[sub];
[main][sub]amix=inputs=2:normalize=0,asoftclip=type=tanh:param=1.2,
apad=pad_dur=1.6,aecho=0.85:0.6:90|210|380:0.35|0.22|0.12,
highpass=f=45,loudnorm=I=-12:TP=-1:LRA=7,
areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse[out]'

for line in "${LINES[@]}"; do
  key=${line%%|*}
  text=${line#*|}
  "$TTS" --voice "$VOICE" --rate=-18% --pitch=-8Hz --text "$text" --write-media "$TMP/$key.mp3" >/dev/null
  ffmpeg -loglevel error -y -i "$TMP/$key.mp3" -filter_complex "$FILTER" -map '[out]' \
    -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/$key.mp3"
  echo "  $OUT/$key.mp3"
done
