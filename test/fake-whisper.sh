#!/bin/sh
# Stellvertreter für whisper-cli in Tests: schreibt ein festes Transkript als JSON.
while [ $# -gt 0 ]; do case "$1" in -of) OF="$2"; shift;; esac; shift; done
echo "whisper_print_progress_callback: progress =  50%" >&2
cat > "$OF.json" <<JSON
{"transcription":[
 {"offsets":{"from":2000,"to":6000},"text":" Okay, neue Runde, los geht's."},
 {"offsets":{"from":30000,"to":34000},"text":" Alter, was war das denn?! Drei auf einmal!"},
 {"offsets":{"from":61000,"to":63000},"text":" [Musik]"},
 {"offsets":{"from":129000,"to":135000},"text":" Und das ist der Sieg, Leute!"}
]}
JSON
echo "whisper_print_progress_callback: progress = 100%" >&2
