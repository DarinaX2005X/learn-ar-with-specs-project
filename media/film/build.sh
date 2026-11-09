#!/usr/bin/env bash
# Join the rendered parts, normalise the score and mux the final film.
set -e
cd "$(dirname "$0")"
ls parts3/p*.mp4 | sort | sed "s#parts3/#file '#; s#\$#'#" > parts3/list.txt
ffmpeg -v error -y -f concat -safe 0 -i parts3/list.txt -c copy picture.mp4
ffmpeg -v error -y -i score.wav -af loudnorm=I=-15:TP=-1.5:LRA=11 -ar 48000 score-norm.wav
ffmpeg -v error -y -i picture.mp4 -i score-norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest sunfall-demo.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact sunfall-demo.mp4
