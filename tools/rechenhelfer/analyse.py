# PC-Analyse für Micha's Video-Zentrale – wird vom Rechenhelfer gestartet (Python 3.11, PyTorch mit CUDA).
#   1. Demucs (htdemucs): Stimme vom Spielton trennen -> voice.wav (16 kHz mono)
#   2. Geräusche (AST, AudioSet): Lachen, Schreien, Jubel, Explosion, Schüsse je Sekunde
#   3. EasyOCR: Text in den Bildern (alle 2 s) – z. B. „VICTORY“, „ELIMINATED“
# Fortschritt als Zeilen „PROGRESS <0-100> <Text>“ auf stdout, Ergebnis in <out>/result.json.
import argparse
import json
import os
import sys
import time
import zipfile

# AudioSet-Klassen, die für Highlights zählen: Name -> (Art, Mindest-Sicherheit)
WANT = {
    'Laughter': ('laugh', 0.25), 'Baby laughter': ('laugh', 0.3), 'Giggle': ('laugh', 0.3), 'Snicker': ('laugh', 0.3),
    'Belly laugh': ('laugh', 0.25), 'Chuckle, chortle': ('laugh', 0.3),
    'Screaming': ('scream', 0.25), 'Shout': ('shout', 0.3), 'Yell': ('shout', 0.3), 'Battle cry': ('shout', 0.3),
    'Children shouting': ('shout', 0.35), 'Whoop': ('cheer', 0.3), 'Cheering': ('cheer', 0.3), 'Applause': ('cheer', 0.35),
    'Crying, sobbing': ('cry', 0.3),
    'Explosion': ('bang', 0.35), 'Gunshot, gunfire': ('bang', 0.35), 'Machine gun': ('bang', 0.4), 'Boom': ('bang', 0.35),
}
VOICE_KINDS = {'laugh', 'scream', 'shout', 'cheer', 'cry'}
GAME_KINDS = {'bang', 'cheer'}


def progress(p, text=''):
    print(f'PROGRESS {int(p)} {text}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--audio')
    ap.add_argument('--frames')
    ap.add_argument('--out', required=True)
    ap.add_argument('--demucs', type=int, default=1)
    ap.add_argument('--events', type=int, default=1)
    ap.add_argument('--ocr', type=int, default=1)
    ap.add_argument('--step', type=float, default=2.0)
    ap.add_argument('--home', default='.')
    a = ap.parse_args()
    t0 = time.time()

    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    result = {'events': [], 'ocr': [], 'device': torch.cuda.get_device_name(0) if dev == 'cuda' else 'Prozessor'}
    os.makedirs(a.out, exist_ok=True)
    stems = {}

    if a.audio and (a.demucs or a.events):
        progress(2, 'Ton laden')
        wav, sr = sf.read(a.audio, dtype='float32', always_2d=True)
        x = torch.from_numpy(wav.T.copy())
        if x.shape[0] == 1:
            x = x.repeat(2, 1)
        x = x[:2]
        if sr != 44100:
            x = torchaudio.functional.resample(x, sr, 44100)
            sr = 44100
        stems['mix'] = torchaudio.functional.resample(x.mean(0, keepdim=True), sr, 16000)[0]

        if a.demucs:
            progress(5, 'Stimme trennen (Demucs)')
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            model = get_model('htdemucs')
            model.to(dev).eval()
            vi = model.sources.index('vocals')
            chunk = sr * 600          # 10 Minuten je Stück – passt in 8 GB Grafikspeicher
            n = x.shape[1]
            voc, rest = [], []
            for i in range(0, n, chunk):
                seg = x[:, i:i + chunk]
                ref = seg.mean(0)
                m, s = ref.mean(), ref.std() + 1e-8
                with torch.no_grad():
                    out = apply_model(model, ((seg - m) / s)[None].to(dev), device=dev, split=True, overlap=0.1, progress=False)[0]
                out = (out * s + m).cpu()
                voc.append(out[vi])
                rest.append(out.sum(0) - out[vi])
                del out
                if dev == 'cuda':
                    torch.cuda.empty_cache()
                progress(5 + 55 * min(1.0, (i + chunk) / n), 'Stimme trennen (Demucs)')
            v = torch.cat(voc, 1)
            r = torch.cat(rest, 1)
            v16 = torchaudio.functional.resample(v.mean(0, keepdim=True), sr, 16000)[0]
            r16 = torchaudio.functional.resample(r.mean(0, keepdim=True), sr, 16000)[0]
            peak = float(v16.abs().max()) or 1.0
            sf.write(os.path.join(a.out, 'voice.wav'), (v16 / max(1.0, peak)).numpy(), 16000, subtype='PCM_16')
            stems['voice'], stems['game'] = v16, r16
            del model
            if dev == 'cuda':
                torch.cuda.empty_cache()

    if a.events and stems:
        progress(62, 'Geräusche erkennen')
        from transformers import ASTFeatureExtractor, ASTForAudioClassification
        name = 'MIT/ast-finetuned-audioset-10-10-0.4593'
        fe = ASTFeatureExtractor.from_pretrained(name)
        model = ASTForAudioClassification.from_pretrained(name).to(dev).eval()
        labels = model.config.id2label
        idx = {int(i): WANT[l] for i, l in labels.items() if l in WANT}
        use = [('voice', stems['voice']), ('game', stems['game'])] if 'voice' in stems else [('mix', stems['mix'])]
        for k, (stem, sig) in enumerate(use):
            sig = sig.numpy()
            win, hop = 32000, 16000           # 2-s-Fenster, jede Sekunde
            starts = list(range(0, max(1, len(sig) - win + 1), hop))
            for b in range(0, len(starts), 16):
                part = starts[b:b + 16]
                batch = [sig[s0:s0 + win] for s0 in part]
                feats = fe(batch, sampling_rate=16000, return_tensors='pt')
                with torch.no_grad():
                    probs = torch.sigmoid(model(**{kk: vv.to(dev) for kk, vv in feats.items()}).logits).cpu().numpy()
                for j, s0 in enumerate(part):
                    for i, (kind, thr) in idx.items():
                        if stem == 'voice' and kind not in VOICE_KINDS:
                            continue
                        if stem == 'game' and kind not in GAME_KINDS:
                            continue
                        p = float(probs[j, i])
                        if p >= thr:
                            result['events'].append({'t': round(s0 / 16000 + 0.5, 1), 'kind': kind, 'label': labels[i], 'score': round(p, 3), 'stem': stem})
                progress(62 + 18 * ((k + min(1.0, (b + 16) / max(1, len(starts)))) / len(use)), 'Geräusche erkennen')
        del model
        if dev == 'cuda':
            torch.cuda.empty_cache()

    if a.ocr and a.frames and os.path.exists(a.frames):
        progress(81, 'Spieltexte lesen')
        import easyocr
        store = os.path.join(a.home, 'easyocr')
        os.makedirs(store, exist_ok=True)
        reader = easyocr.Reader(['de', 'en'], gpu=(dev == 'cuda'), model_storage_directory=store, verbose=False)
        z = zipfile.ZipFile(a.frames)
        names = sorted(n for n in z.namelist() if n.endswith('.jpg'))
        for i, nm in enumerate(names):
            try:
                t = float(os.path.basename(nm)[1:7])
            except ValueError:
                t = i * a.step
            for _box, text, conf in reader.readtext(z.read(nm)):
                text = str(text).strip()
                if conf >= 0.45 and len(text) >= 2:
                    result['ocr'].append({'t': t, 'text': text[:80]})
            if i % 20 == 0:
                progress(81 + 18 * (i + 1) / max(1, len(names)), 'Spieltexte lesen')

    result['took'] = round(time.time() - t0, 1)
    with open(os.path.join(a.out, 'result.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)
    progress(100, 'fertig')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # Fehlermeldung für den Rechenhelfer
        print(f'FEHLER {type(e).__name__}: {e}', flush=True)
        sys.exit(1)
