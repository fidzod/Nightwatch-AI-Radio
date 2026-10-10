#!/usr/bin/env bash
# Phase 1 placeholder audio: short synthetic tones standing in for real
# music, purely to prove crossfade + static/fuzz mechanics work before any
# real mp3s are uploaded. Swap in real tracks later via the uploader (Phase
# 4) or by dropping files into audio/library/<collection>/ directly.
#
# Run via: nix develop -c scripts/generate-test-tracks.sh
set -euo pipefail
cd "$(dirname "$0")/.."

out_dir="audio/library/test-collection"
mkdir -p "$out_dir"

for i in 1 2 3 4; do
  freq=$((220 + i * 55))
  dur=$((8 + i))
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=${freq}:duration=${dur}" \
    -af "afade=t=in:d=1,afade=t=out:st=$((dur - 1)):d=1" \
    -codec:a libmp3lame -q:a 4 \
    "${out_dir}/test-track-${i}.mp3"
done

echo "Generated 4 placeholder tracks in ${out_dir}/"
