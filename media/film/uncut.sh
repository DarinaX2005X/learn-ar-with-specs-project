#!/usr/bin/env bash
# One continuous take, no cuts: the raw Preview recording (timeScale 0.1) sped back up to real lens speed.
cd "$(dirname "$0")"
ffmpeg -v error -y -i "../raw/$1.mp4" -vf "setpts=PTS/10,fps=30,crop=1037:1184:761:0,scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x1d2331" -an -c:v h264_nvenc -cq 19 -pix_fmt yuv420p "../../submission-sunfall/$2"
ffprobe -v error -show_entries format=duration -of csv=p=0 "../../submission-sunfall/$2"
