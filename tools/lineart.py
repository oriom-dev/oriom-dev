#!/usr/bin/env python3
"""Turn a logo or photo into ONE continuous stroke for the 1D design.

  nix develop -c python3 tools/lineart.py            # all entries of tools/lineart.json
  nix develop -c python3 tools/lineart.py tompedia   # one entry

Output: content/art/<slug>.json = {"aspect": w/h, "p": [x0, y0, dx, dy, ...]} where the
points are on a 0..1000 grid (scaled to the box's width), delta-encoded, and the
client draws a smooth Catmull-Rom curve through them. The stroke starts on the left
edge and ends on the right edge so the page's thread can pass straight through.
Sources live in .cache/art-src (not committed); only the derived strokes are.
"""
import json, math, sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.morphology import skeletonize

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.cache/art-src'
OUT = ROOT / 'content/art'
GRID = 1000


def load(cfg):
    path = SRC / cfg['src']
    if path.suffix == '.svg':
        import cairosvg, io
        png = cairosvg.svg2png(url=str(path), output_width=cfg.get('size', 400))
        im = Image.open(io.BytesIO(png)).convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    else:
        im = Image.open(path).convert('RGB')
    if 'crop' in cfg:  # fractions: [left, top, right, bottom]
        l, t, r, b = cfg['crop']
        w, h = im.size
        im = im.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    size = cfg.get('size', 400)
    im.thumbnail((size, size), Image.LANCZOS)
    return np.array(im.convert('RGB'))


def mask_of(img, cfg):
    """Foreground = far enough from the background colour (sampled at the corners)."""
    h, w, _ = img.shape
    if 'bg' in cfg:
        bg = np.array(cfg['bg'], float)
    else:
        corners = np.array([img[0, 0], img[0, -1], img[-1, 0], img[-1, -1]], float)
        bg = np.median(corners, axis=0)
    dist = np.linalg.norm(img.astype(float) - bg, axis=2)
    m = (dist > cfg.get('threshold', 60)).astype(np.uint8)
    k = cfg.get('close', 1)
    if k:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k * 2 + 1, k * 2 + 1), np.uint8))
    return m


def contours(img, cfg):
    m = mask_of(img, cfg)
    cs, _ = cv2.findContours(m, cv2.RETR_LIST if cfg.get('holes', True) else cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    eps = cfg.get('eps', 1.2)
    out = []
    for c in cs:
        if cv2.arcLength(c, True) < cfg.get('min_len', 25):
            continue
        a = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float)
        out.append(np.vstack([a, a[:1]]))  # closed
    return out, m.shape


def skeleton_strokes(img, cfg):
    """Edges of a photo, thinned to 1px and walked into polylines."""
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    g = cv2.bilateralFilter(g, 9, 60, 9)
    e = cv2.Canny(g, cfg.get('lo', 60), cfg.get('hi', 150))
    e = cv2.dilate(e, np.ones((2, 2), np.uint8))
    sk = skeletonize(e > 0)
    pts = set(zip(*np.nonzero(sk)))
    strokes = []
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while pts:
        # start from an endpoint when possible
        start = next((p for p in pts if sum((p[0] + dy, p[1] + dx) in pts for dy, dx in nb) == 1), next(iter(pts)))
        line = [start]
        pts.discard(start)
        cur = start
        while True:
            nxt = next(((cur[0] + dy, cur[1] + dx) for dy, dx in nb if (cur[0] + dy, cur[1] + dx) in pts), None)
            if nxt is None:
                break
            pts.discard(nxt)
            line.append(nxt)
            cur = nxt
        if len(line) >= cfg.get('min_len', 20):
            a = np.array([[x, y] for y, x in line], np.float32).reshape(-1, 1, 2)
            strokes.append(cv2.approxPolyDP(a, cfg.get('eps', 1.5), False)[:, 0, :].astype(float))
    return strokes, g.shape


def order(strokes, closed, drift=0.6):
    """Greedy nearest-neighbour tour that sweeps left to right (moving left costs extra),
    so the stroke enters on the left, leaves on the right, and the long connecting
    lines stay short. Closed loops may start anywhere."""
    if not strokes:
        return []
    rest = list(strokes)
    cur = np.array([-1e9, np.mean([s[:, 1].mean() for s in rest])])
    path = []
    while rest:
        best = None
        for i, s in enumerate(rest):
            if closed:
                d = np.linalg.norm(s[:-1] - cur, axis=1) + drift * np.maximum(cur[0] - s[:-1, 0], 0)
                j = int(d.argmin())
                cand = (d[j], i, j, False)
            else:
                d0 = np.linalg.norm(s[0] - cur) + drift * max(cur[0] - s[0, 0], 0)
                d1 = np.linalg.norm(s[-1] - cur) + drift * max(cur[0] - s[-1, 0], 0)
                cand = (min(d0, d1), i, 0, d1 < d0)
            if best is None or cand[0] < best[0]:
                best = cand
        _, i, j, rev = best
        s = rest.pop(i)
        if closed:
            s = np.vstack([s[j:-1], s[:j], s[j:j + 1]])
        elif rev:
            s = s[::-1]
        path.append(s)
        cur = s[-1]
    return path


def encode(path, shape, cfg):
    pts = np.vstack(path)
    # fit the drawing into the box with a small margin, keep aspect
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    bw, bh = max(x1 - x0, 1), max(y1 - y0, 1)
    pad = cfg.get('pad', 0.06)
    aspect = bw / bh
    scale = GRID * (1 - 2 * pad) / bw
    pts = (pts - [x0, y0]) * scale + [GRID * pad, GRID * pad / aspect]
    hgt = GRID / aspect
    # enter from the left edge, leave from the right edge, at the stroke's own heights
    first, last = pts[0], pts[-1]
    pts = np.vstack([[0, first[1]], pts, [GRID, last[1]]])
    q = np.round(pts).astype(int)
    if not cfg.get('sharp'):
        keep = [0] + [i for i in range(1, len(q)) if (q[i] != q[i - 1]).any()]
        q = q[keep]
    flat = [int(q[0, 0]), int(q[0, 1])]
    for a, b in zip(q[:-1], q[1:]):
        flat += [int(b[0] - a[0]), int(b[1] - a[1])]
    return {'aspect': round(aspect, 4), 'p': flat}


def procedural(cfg):
    """Drawn from formulas, for works that only have screenshots."""
    fn = cfg['fn']
    t = np.linspace(0, 1, 400)
    if fn == 'anneal':  # Kytos: an energy landscape and the ball that settles in the global minimum
        x = t * 400
        y = 150 - 60 * np.exp(-((x - 270) / 45) ** 2) - 25 * np.exp(-((x - 110) / 30) ** 2) + 12 * np.sin(x / 13)
        land = np.c_[x, y]
        a = np.linspace(0, 2 * np.pi, 40)
        ball = np.c_[270 + 10 * np.cos(a + np.pi), 70 + 10 * np.sin(a + np.pi)]
        hop = np.c_[np.linspace(110, 260, 60), 95 - 70 * np.sin(np.linspace(0, np.pi, 60))]
        return [land[:110], hop, ball, land[110:]]
    if fn == 'ridge':  # Q-Sherpa: a mountain ridge, a path up and a flag on the summit
        x = t * 400
        y = 170 - 120 * np.exp(-((x - 200) / 70) ** 2) - 40 * np.exp(-((x - 90) / 40) ** 2) - 50 * np.exp(-((x - 320) / 50) ** 2)
        y += 3 * np.sin(x / 5)
        i = int(np.argmin(y))
        flag = np.array([[x[i], y[i]], [x[i], y[i] - 45], [x[i] + 28, y[i] - 36], [x[i], y[i] - 27], [x[i], y[i]]])
        return [np.c_[x[:i + 1], y[:i + 1]], flag, np.c_[x[i:], y[i:]]]
    if fn == 'mesh':  # Mosimo: phones relaying a post hop by hop with radio arcs
        out = []
        xs = [20, 140, 260, 380]
        for k, cx in enumerate(xs):
            cy = 110 + (25 if k % 2 else -25)
            phone = np.array([[cx - 18, cy + 32], [cx - 18, cy - 32], [cx + 18, cy - 32], [cx + 18, cy + 32], [cx - 18, cy + 32]])
            out.append(phone)
            if k < len(xs) - 1:
                for r in (22, 38, 54):
                    a = np.linspace(-0.7, 0.7, 14)
                    arc = np.c_[cx + 18 + r * np.cos(a), cy + r * np.sin(a)]
                    out.append(arc)
        return out
    if fn == 'qr':  # QR GENERATOR.: three finder patterns and a few modules
        sq = lambda x, y, s: np.array([[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]], float)
        out = []
        for x, y in ((0, 0), (0, 140), (140, 0)):
            out += [sq(x, y, 70), sq(x + 12, y + 12, 46), sq(x + 24, y + 24, 22)]
        rng = np.random.default_rng(7)
        for _ in range(14):
            x, y = rng.integers(9, 21, 2) * 10
            out.append(sq(x, y, 10))
        return out
    if fn == 'match':  # Labo-Match: students and labs, matched by arcs
        out = []
        for i in range(5):
            out.append(np.c_[30 + 8 * np.cos(np.linspace(0, 2 * np.pi, 20)), 30 + i * 45 + 8 * np.sin(np.linspace(0, 2 * np.pi, 20))])
        for j in range(3):
            y = 50 + j * 70
            out.append(np.array([[330, y - 14], [358, y - 14], [358, y + 14], [330, y + 14], [330, y - 14]], float))
        for i, j in ((0, 0), (1, 1), (2, 0), (3, 2), (4, 1)):
            a, b = np.array([38, 30 + i * 45]), np.array([330, 50 + j * 70])
            u = np.linspace(0, 1, 30)[:, None]
            m = (a + b) / 2 + [0, -30]
            out.append((1 - u) ** 2 * a + 2 * (1 - u) * u * m + u ** 2 * b)
        return out
    raise ValueError(fn)


def main():
    cfgs = json.loads((ROOT / 'tools/lineart.json').read_text())
    only = set(sys.argv[1:])
    OUT.mkdir(exist_ok=True)
    for slug, cfg in cfgs.items():
        if only and slug not in only:
            continue
        if cfg.get('mode') == 'proc':
            strokes = procedural(cfg)
            if cfg.get('sharp'):
                strokes = [np.repeat(st, 2, axis=0) if len(st) <= 6 else st for st in strokes]
            art = encode(order(strokes, False) if cfg.get('reorder') else strokes, None, cfg)
            art['title'] = cfg.get('title', slug)
            text = json.dumps(art, separators=(',', ':'), ensure_ascii=False)
            (OUT / f'{slug}.json').write_text(text + '\n')
            print(f'{slug}: {len(art["p"]) // 2} points, {len(text) / 1024:.1f} KB')
            continue
        img = load(cfg)
        if cfg.get('mode') == 'edges':
            strokes, shape = skeleton_strokes(img, cfg)
            closed = False
        else:
            strokes, shape = contours(img, cfg)
            closed = True
        art = encode(order(strokes, closed), shape, cfg)
        art['title'] = cfg.get('title', slug)
        text = json.dumps(art, separators=(',', ':'), ensure_ascii=False)
        (OUT / f'{slug}.json').write_text(text + '\n')
        print(f'{slug}: {len(art["p"]) // 2} points, {len(text) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
