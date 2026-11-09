#!/usr/bin/env bash
# Raw take (recorded at timeScale 0.1, 10 fps) -> footage frames at real lens speed, 30 fps, display region only.
cd "$(dirname "$0")"
for n in "$@"; do
  mkdir -p "footage/$n"
  ffmpeg -v error -y -i "../raw/$n.mp4" -vf "setpts=PTS/10,fps=30,crop=1037:1184:761:0,scale=760:-2" -q:v 3 "footage/$n/%05d.jpg"
  echo "$n $(ls footage/$n | wc -l) frames"
done
