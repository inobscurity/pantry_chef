#!/bin/sh
# Gives index.html's scripts and stylesheet a new version (?v=...), so phones load the new code on
# the next refresh instead of a copy GitHub Pages lets them keep for 10 minutes. Run before pushing.
cd "$(dirname "$0")/.." && V=$(date +%Y%m%d%H%M) && sed -i -E "s#\?v=[0-9]+#?v=$V#g" index.html && echo "version $V"
