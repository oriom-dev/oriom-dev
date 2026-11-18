#!/usr/bin/env python3
"""Turn a logo, or a figure drawn from formulas, into smooth line art.

  nix develop -c python3 tools/lineart.py            # all entries of tools/lineart.json
  nix develop -c python3 tools/lineart.py tompedia   # one entry

Output: content/art/<slug>.json =
  {"aspect": w/h, "s": [[x0, y0, dx, dy, ...], ...], "c": [1, 0, ...], "title": ...}
Each stroke is a list of evenly spaced points on a 0..1000 grid (scaled to the box
width), delta-encoded; "c" marks closed strokes. Clients draw a smooth Catmull-Rom
curve through each stroke. The strokes are stored in drawing order and direction, so
the 1D page can join them into one line with tangent-continuous connectors; the 2D
and 3D pages simply draw them one by one.
Sources live in .cache/art-src (not committed); only the derived strokes are.
"""
import io, json, math, sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.cache/art-src'
OUT = ROOT / 'content/art'
GRID = 1000


def load(cfg):
    path = SRC / cfg['src']
    size = cfg.get('size', 320)
    if path.suffix == '.svg':
        import cairosvg
        png = cairosvg.svg2png(url=str(path), output_width=size)
        im = Image.open(io.BytesIO(png)).convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    else:
        im = Image.open(path).convert('RGB')
    if 'crop' in cfg:
        l, t, r, b = cfg['crop']
        w, h = im.size
        im = im.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    im.thumbnail((size, size), Image.LANCZOS)
    return np.array(im.convert('RGB'))


def smooth_closed(pts, sigma, spacing):
    """Gaussian-smooth a closed pixel contour, then resample it evenly."""
    n = len(pts)
    k = max(1, int(sigma * 3))
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    w /= w.sum()
    ext = np.vstack([pts[-k:], pts, pts[:k]])
    sm = np.stack([np.convolve(ext[:, i], w, mode='valid') for i in range(2)], axis=1)[:n]
    return resample(np.vstack([sm, sm[:1]]), spacing)[:-1]


def resample(pts, spacing):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    if d[-1] < spacing:
        return pts[[0, -1]]
    t = np.linspace(0, d[-1], max(3, int(round(d[-1] / spacing)) + 1))
    return np.stack([np.interp(t, d, pts[:, i]) for i in range(2)], axis=1)


def logo_strokes(img, cfg):
    """Every contour that matters, lightly smoothed and then thinned to the few points a
    Catmull-Rom curve needs: the drawing keeps its parts, the file stays small."""
    h, w, _ = img.shape
    if cfg.get('mask') == 'bright':  # light shapes on a busy background
        m = (img.astype(float).mean(axis=2) > cfg.get('threshold', 200)).astype(np.uint8)
    else:
        corners = np.array([img[0, 0], img[0, -1], img[-1, 0], img[-1, -1]], float)
        bg = np.array(cfg['bg'], float) if 'bg' in cfg else np.median(corners, axis=0)
        m = (np.linalg.norm(img.astype(float) - bg, axis=2) > cfg.get('threshold', 70)).astype(np.uint8)
    k = cfg.get('close', 1)
    if k:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    mode = cv2.RETR_LIST if cfg.get('holes', True) else cv2.RETR_EXTERNAL
    cs, _ = cv2.findContours(m, mode, cv2.CHAIN_APPROX_NONE)
    size = (w + h) / 2
    cs = sorted((c[:, 0, :].astype(float) for c in cs), key=lambda c: -cv2.arcLength(c.astype(np.float32), True))
    cs = [c for c in cs if cv2.arcLength(c.astype(np.float32), True) >= cfg.get('min_len', 0.04) * size]
    if cfg.get('drop_frame'):  # the image border itself, when the shape fills the canvas
        cs = [c for c in cs if not (c[:, 0].min() <= 1 and c[:, 1].min() <= 1 and c[:, 0].max() >= w - 2 and c[:, 1].max() >= h - 2)]
    cs = cs[:cfg.get('max_strokes', 40)]
    out = []
    for c in cs:
        sm = smooth_closed(c, cfg.get('sigma', 0.9), 1.0)
        poly = cv2.approxPolyDP(sm.astype(np.float32).reshape(-1, 1, 2), cfg.get('eps', 0.006) * size, True)[:, 0, :]
        if len(poly) >= 3:
            out.append((poly.astype(float), True))
    return out


def rounded_rect(x, y, w, h, r, n=10):
    pts = []
    for cx, cy, a0 in ((x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)):
        for i in range(n):
            a = math.radians(a0 + 90 * i / (n - 1))
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return np.array(pts), True


def circle(cx, cy, r, n=20):
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.c_[cx + r * np.cos(a), cy + r * np.sin(a)], True


def bezier(a, c1, c2, b, n=24):
    t = np.linspace(0, 1, n)[:, None]
    a, c1, c2, b = map(np.array, (a, c1, c2, b))
    return (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * b, False


def procedural(fn):
    """Simple figures for works that only have screenshots: few strokes, no corners."""
    if fn == 'anneal':  # Kytos: an energy landscape and a ball settling in the deepest valley
        x = np.linspace(0, 400, 90)
        y = 150 - 62 * np.exp(-((x - 270) / 48) ** 2) - 26 * np.exp(-((x - 110) / 32) ** 2) + 7 * np.sin(x / 22)
        i = int(np.argmin(y))
        # left slope, a hop over the hill into the valley, a lap round the ball, right slope
        j = int(np.argmin(np.abs(x - 110)))
        a = np.linspace(np.pi / 2, np.pi / 2 + 2 * np.pi, 24)
        ball = np.c_[x[i] + 13 * np.cos(a), y[i] - 13 - 13 * np.sin(a)]
        return [(np.c_[x[:j + 1], y[:j + 1]], False), bezier((x[j], y[j]), (140, 40), (230, 30), (x[i], y[i] - 26), 20),
                (ball, False), (np.c_[x[i:], y[i:]], False)]
    if fn == 'ridge':  # Q-Sherpa: a ridge with a pennant on the summit
        x = np.linspace(0, 400, 90)
        y = 175 - 120 * np.exp(-((x - 200) / 72) ** 2) - 38 * np.exp(-((x - 85) / 42) ** 2) - 46 * np.exp(-((x - 320) / 50) ** 2)
        i = int(np.argmin(y))
        px, py = x[i], y[i]
        # up the left slope, up the pole, round the pennant, down again, down the right slope
        flag = np.vstack([bezier((px, py - 50), (px + 18, py - 52), (px + 24, py - 44), (px + 32, py - 40), 10)[0],
                          bezier((px + 32, py - 40), (px + 22, py - 36), (px + 14, py - 30), (px, py - 30), 10)[0][1:]])
        return [(np.c_[x[:i + 1], y[:i + 1]], False), (np.array([[px, py], [px, py - 25], [px, py - 50]]), False),
                (flag, False), (np.array([[px, py - 30], [px, py - 15], [px, py]]), False), (np.c_[x[i:], y[i:]], False)]
    if fn == 'mesh':  # Mosimo: phones passing a post along by radio
        out = []
        xs = [30, 160, 290]
        for k, x in enumerate(xs):
            y = 60 + (30 if k % 2 else 0)
            out.append(rounded_rect(x, y, 56, 96, 12))
            if k < len(xs) - 1:
                for r in (26, 46):
                    a = np.linspace(-0.55, 0.55, 12)
                    out.append((np.c_[x + 70 + r * np.cos(a), y + 48 + 15 * (1 if k % 2 == 0 else -1) * 0 + r * np.sin(a)], False))
        return out
    if fn == 'qr':  # QR GENERATOR.: the three finder patterns, rounded
        out = []
        for x, y in ((0, 0), (0, 150), (150, 0)):
            out += [rounded_rect(x, y, 90, 90, 18), rounded_rect(x + 27, y + 27, 36, 36, 9)]
        out.append(circle(195, 195, 16))
        return out
    if fn == 'match':  # Labo-Match: students on the left, labs on the right, matched by curves
        out = []
        for i in range(4):
            out.append(circle(30, 30 + i * 55, 12))
        for j in range(3):
            out.append(rounded_rect(330, 30 + j * 70, 44, 44, 12))
        for i, j in ((0, 0), (1, 2), (2, 1), (3, 2)):
            a, b = (42, 30 + i * 55), (330, 52 + j * 70)
            out.append(bezier(a, (160, a[1]), (220, b[1]), b, 18))
        return out
    if fn == 'stage':  # 国高祭: an open curtain over the stage, and a camera on a tripod in front
        curtain_l = bezier((0, 0), (40, 60), (20, 120), (70, 150), 20)
        top = bezier((0, 0), (120, 18), (240, 18), (360, 0), 24)
        curtain_r = bezier((360, 0), (320, 60), (340, 120), (290, 150), 20)
        floor = bezier((10, 170), (120, 165), (240, 165), (350, 170), 20)
        cam = rounded_rect(140, 195, 70, 44, 10)
        lens = circle(222, 217, 12, 16)
        legs = bezier((175, 239), (170, 262), (160, 280), (150, 300), 8)
        legs2 = bezier((175, 239), (180, 262), (190, 280), (200, 300), 8)
        return [curtain_l, top, curtain_r, floor, cam, lens, legs, legs2]
    if fn in ('badge-ai', 'badge-quantum'):  # Open Badges: the arched shield, and its emblem
        a = np.linspace(np.pi, 2 * np.pi, 28)
        arch = np.c_[100 + 100 * np.cos(a), 100 + 100 * np.sin(a)]
        shield = np.vstack([arch, [[200, 120], [200, 210]], bezier((200, 210), (200, 225), (190, 232), (175, 232), 6)[0],
                            [[25, 232]], bezier((25, 232), (10, 232), (0, 225), (0, 210), 6)[0], [[0, 120]]])
        out = [(shield, True), (np.array([[12, 196], [188, 196]], float), False)]
        if fn == 'badge-ai':
            out += [circle(100, 85, 34, 24), (np.array([[45, 145], [155, 145]], float), False), (np.array([[60, 168], [140, 168]], float), False)]
        else:
            t = np.linspace(0, 2 * np.pi, 30, endpoint=False)
            for rot in (0, np.pi / 3, -np.pi / 3):
                x, y = 46 * np.cos(t), 16 * np.sin(t)
                out.append((np.c_[100 + x * np.cos(rot) - y * np.sin(rot), 105 + x * np.sin(rot) + y * np.cos(rot)], True))
            out.append(circle(100, 105, 6, 12))
        return out
    raise ValueError(fn)


def order(strokes, drift=0.7):
    """Greedy left-to-right tour; closed strokes start nearest, open ones may flip."""
    rest = list(strokes)
    cur = np.array([-1e9, np.mean([s.mean(axis=0)[1] for s, _ in rest])])
    path = []
    while rest:
        best = None
        for i, (s, closed) in enumerate(rest):
            cost = np.linalg.norm(s - cur, axis=1) + drift * np.maximum(cur[0] - s[:, 0], 0)
            if closed:
                j = int(cost.argmin())
                cand = (cost[j], i, j, False)
            else:
                cand = min((cost[0], i, 0, False), (cost[-1], i, 0, True))
            if best is None or cand[0] < best[0]:
                best = cand
        _, i, j, rev = best
        s, closed = rest.pop(i)
        if closed:
            s = np.vstack([s[j:], s[:j]])
            # go round in the direction that leaves the previous point most smoothly
            if len(path) and np.dot(s[1] - s[0], s[0] - cur) < np.dot(s[-1] - s[0], s[0] - cur):
                s = np.vstack([s[:1], s[1:][::-1]])
        elif rev:
            s = s[::-1]
        path.append((s, closed))
        cur = s[0] if closed else s[-1]
    return path


def encode(strokes, cfg):
    pts = np.vstack([s for s, _ in strokes])
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    bw, bh = max(x1 - x0, 1), max(y1 - y0, 1)
    pad = cfg.get('pad', 0.06)
    aspect = (bw * (1 + 2 * pad)) / (bh + bw * 2 * pad)
    scale = GRID * (1 - 2 * pad) / bw
    out, closed = [], []
    for s, c in strokes:
        q = np.round((s - [x0, y0]) * scale + GRID * pad).astype(int)
        keep = [0] + [i for i in range(1, len(q)) if (q[i] != q[i - 1]).any()]
        q = q[keep]
        flat = [int(q[0, 0]), int(q[0, 1])]
        for a, b in zip(q[:-1], q[1:]):
            flat += [int(b[0] - a[0]), int(b[1] - a[1])]
        out.append(flat)
        closed.append(1 if c else 0)
    return {'aspect': round(float(aspect), 4), 's': out, 'c': closed}


def main():
    cfgs = json.loads((ROOT / 'tools/lineart.json').read_text())
    only = set(sys.argv[1:])
    OUT.mkdir(exist_ok=True)
    for slug, cfg in cfgs.items():
        if only and slug not in only:
            continue
        strokes = procedural(cfg['fn']) if cfg.get('mode') == 'proc' else logo_strokes(load(cfg), cfg)
        strokes = [(np.asarray(s, float), c) for s, c in strokes]
        art = encode(strokes if cfg.get('keep_order') else order(strokes), cfg)
        art['title'] = cfg.get('title', slug)
        text = json.dumps(art, separators=(',', ':'), ensure_ascii=False)
        (OUT / f'{slug}.json').write_text(text + '\n')
        n = sum(len(s) // 2 for s in art['s'])
        print(f'{slug}: {len(art["s"])} strokes, {n} points, {len(text) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
