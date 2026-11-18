"""Fit cubic Bézier curves to a polyline (Philip J. Schneider, "An Algorithm for
Automatically Fitting Digitized Curves", Graphics Gems, 1990), splitting at corners,
and turn nearly straight pieces into lines. Used by tools/lineart.py."""
import numpy as np


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def _bez(c, t):
    t = np.asarray(t)[:, None]
    return (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t ** 2 * c[2] + t ** 3 * c[3]


def _bez1(c, t):
    t = np.asarray(t)[:, None]
    return 3 * (1 - t) ** 2 * (c[1] - c[0]) + 6 * (1 - t) * t * (c[2] - c[1]) + 3 * t ** 2 * (c[3] - c[2])


def _bez2(c, t):
    t = np.asarray(t)[:, None]
    return 6 * (1 - t) * (c[2] - 2 * c[1] + c[0]) + 6 * t * (c[3] - 2 * c[2] + c[1])


def _chord(pts):
    d = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    return d / d[-1] if d[-1] > 0 else d


def _generate(pts, u, lt, rt):
    p0, p3 = pts[0], pts[-1]
    a1 = lt[None, :] * (3 * (1 - u) ** 2 * u)[:, None]
    a2 = rt[None, :] * (3 * (1 - u) * u ** 2)[:, None]
    C = np.array([[np.sum(a1 * a1), np.sum(a1 * a2)], [np.sum(a1 * a2), np.sum(a2 * a2)]])
    tmp = pts - _bez(np.array([p0, p0, p3, p3]), u)
    X = np.array([np.sum(a1 * tmp), np.sum(a2 * tmp)])
    det = C[0, 0] * C[1, 1] - C[1, 0] * C[0, 1]
    al = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det if abs(det) > 1e-12 else 0
    ar = (C[0, 0] * X[1] - C[1, 0] * X[0]) / det if abs(det) > 1e-12 else 0
    seg = np.linalg.norm(p3 - p0)
    if al < 1e-6 * seg or ar < 1e-6 * seg:
        al = ar = seg / 3
    return np.array([p0, p0 + lt * al, p3 + rt * ar, p3])


def _reparam(c, pts, u):
    d = _bez(c, u) - pts
    n = np.sum(d * _bez1(c, u), axis=1)
    den = np.sum(_bez1(c, u) ** 2 + d * _bez2(c, u), axis=1)
    with np.errstate(divide='ignore', invalid='ignore'):
        nu = np.where(np.abs(den) > 1e-12, u - n / den, u)
    return np.clip(nu, 0, 1)


def _max_err(c, pts, u):
    d = np.sum((_bez(c, u) - pts) ** 2, axis=1)
    i = int(np.argmax(d))
    return d[i], (i if 0 < i < len(pts) - 1 else len(pts) // 2)


def fit(pts, err):
    """Cubic segments ([p0, c1, c2, p3]) through pts within err (in the points' units)."""
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return []
    return _fit(pts, _unit(pts[1] - pts[0]), _unit(pts[-2] - pts[-1]), err * err)


def _fit(pts, lt, rt, err2):
    if len(pts) == 2:
        d = np.linalg.norm(pts[1] - pts[0]) / 3
        return [np.array([pts[0], pts[0] + lt * d, pts[1] + rt * d, pts[1]])]
    u = _chord(pts)
    c = _generate(pts, u, lt, rt)
    e, split = _max_err(c, pts, u)
    if e < err2:
        return [c]
    if e < err2 * 16:
        for _ in range(12):
            u = _reparam(c, pts, u)
            c = _generate(pts, u, lt, rt)
            e, split = _max_err(c, pts, u)
            if e < err2:
                return [c]
    ct = _unit(pts[split - 1] - pts[split + 1])
    return _fit(pts[:split + 1], lt, ct, err2) + _fit(pts[split:], -ct, rt, err2)


def corners(pts, closed, angle=55, window=3):
    """Indices where the outline turns sharply (split points for fitting)."""
    n = len(pts)
    out = []
    for i in range(n if closed else n - 1):
        if not closed and (i < window or i > n - 1 - window):
            continue
        a = pts[(i - window) % n] - pts[i]
        b = pts[(i + window) % n] - pts[i]
        cos = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
        if np.degrees(np.arccos(np.clip(cos, -1, 1))) < 180 - angle:
            out.append(i)
    # keep one index per cluster of neighbours
    kept = []
    for i in out:
        if not kept or i - kept[-1] > window:
            kept.append(i)
    return kept


def is_line(c, tol):
    p0, p3 = c[0], c[3]
    d = p3 - p0
    L = np.linalg.norm(d)
    if L < 1e-9:
        return True
    nrm = np.array([-d[1], d[0]]) / L
    return abs(np.dot(c[1] - p0, nrm)) < tol and abs(np.dot(c[2] - p0, nrm)) < tol


def fit_stroke(pts, closed, err, corner_angle=55):
    """Segments for a stroke: split at corners, fit each piece; closed strokes wrap."""
    pts = np.asarray(pts, float)
    if closed and np.linalg.norm(pts[0] - pts[-1]) < 1e-6:
        pts = pts[:-1]
    n = len(pts)
    cs = corners(pts, closed, corner_angle)
    if closed:
        if not cs:
            cs = [0, n // 2]
        pieces = []
        for k, i in enumerate(cs):
            j = cs[(k + 1) % len(cs)]
            idx = list(range(i, j + 1)) if j > i else list(range(i, n)) + list(range(0, j + 1))
            pieces.append(pts[idx])
    else:
        bounds = [0] + cs + [n - 1]
        pieces = [pts[a:b + 1] for a, b in zip(bounds[:-1], bounds[1:]) if b > a]
    segs = []
    for p in pieces:
        segs += fit(p, err)
    return segs
