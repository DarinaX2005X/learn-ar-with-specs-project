#!/usr/bin/env bash
# Render the film in three parallel chunks, then score and mux.
cd "$(dirname "$0")"
mkdir -p parts3
python render.py video parts3/p0.mp4 0 26 > parts3/log0.txt 2>&1 &
python render.py video parts3/p1.mp4 26 52 > parts3/log1.txt 2>&1 &
python render.py video parts3/p2.mp4 52 77 > parts3/log2.txt 2>&1 &
wait
python audio.py events.json score.wav && bash build.sh
ffmpeg -i sunfall-demo.mp4 -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input Integrated|Input True Peak"
