#!/bin/sh
# Stellvertreter für whisper-cli in Tests: schreibt ein festes Transkript (ein Segment je Wort) als JSON.
while [ $# -gt 0 ]; do case "$1" in -of) OF="$2"; shift;; esac; shift; done
echo "whisper_print_progress_callback: progress =  50%" >&2
node -e '
let lines = [[2, "Okay, neue Runde, los gehts."], [30, "Alter, was war das denn?! Drei auf einmal!"], [61, "[Musik]"], [129, "Und das ist der Sieg, Leute!"]];
// FAKE_WHISPER_DENSE=<Sekunden>: alle 10 s ein Satz (0–6,5 s gesprochen, danach Pause) – passend zu Testton mit Pausen
const dense = Number(process.env.FAKE_WHISPER_DENSE || 0);
if (dense) { lines = []; for (let t = 0; t < dense; t += 10) lines.push([t + 0.3, "Ja ähm also das war jetzt echt richtig stark gespielt Leute ähm schaut mal hier"]); }
const tr = [];
for (const [t0, text] of lines) { let t = t0 * 1000; for (const w of text.split(" ")) { tr.push({ offsets: { from: t, to: t + 380 }, text: " " + w }); t += 420; } }
require("fs").writeFileSync(process.argv[1] + ".json", JSON.stringify({ transcription: tr }));
' "$OF"
echo "whisper_print_progress_callback: progress = 100%" >&2
