#!/usr/bin/env python3
"""Render content/art/*.json as a contact sheet, using the same Catmull-Rom curve as the client."""
import io, json, sys
from pathlib import Path
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

def points(art):
    p = art['p']; x, y = p[0], p[1]; out = [(x, y)]
    for i in range(2, len(p), 2):
        x += p[i]; y += p[i + 1]; out.append((x, y))
    return out

def d_of(all_pts):
    # same as src/shared/art.ts: repeated points are corners that split smooth runs
    runs = [[all_pts[0]]]
    for a, b in zip(all_pts, all_pts[1:]):
        if a == b: runs.append([b])
        else: runs[-1].append(b)
    d = f'M{all_pts[0][0]},{all_pts[0][1]}'
    for pts in runs:
      for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, len(pts) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f'C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]},{p2[1]}'
    return d

files = sorted((ROOT / 'content/art').glob('*.json'))
W = 300
tiles = []
for f in files:
    art = json.loads(f.read_text())
    h = 1000 / art['aspect']
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 {h}" width="{W}" height="{W / art["aspect"]}"><rect width="1000" height="{h}" fill="white"/><path d="{d_of(points(art))}" fill="none" stroke="black" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>'
    tiles.append((f.stem, Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode())))))
cols = 4
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * W), 'white')
for i, (_, t) in enumerate(tiles):
    t.thumbnail((W - 10, W - 10)); sheet.paste(t, ((i % cols) * W + 5, (i // cols) * W + 5))
out = sys.argv[1] if len(sys.argv) > 1 else 'artsheet.png'
sheet.save(out)
print(out, [n for n, _ in tiles])
