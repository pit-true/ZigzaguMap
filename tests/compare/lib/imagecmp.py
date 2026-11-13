"""マップ表示領域の画像の比較と差分画像。

既定の比べ方（mode "gba"）: GBA の色は 15bit なので、両方の画素を各色 5bit（値 >> 3）に落としてから比べる。
AdvanceMap は 5bit を `<<3` で、ZigzaguMap は `<<3 | >>2` で 8bit にしているため、8bit のままだと必ずずれる。
mode "tolerance": 各色の差が tolerance 以下なら同じとみなす（重ね描きの半透明や文字など、GBA の色でない部分向け）。
mode "cellMean": マスごとの平均色の差が tolerance（既定 12）以下なら同じ（移動許可の文字のように、字形だけ違う飾りを許す）。
mode "overlayCells": 同じアプリのブロックだけの画像（base）と比べて「重ね描きがあるマス」を求め、そのマスの集合を比べる
  （イベントの箱の色や形は比べず、位置だけ比べる）。

判定は 16px のマス単位。マスの中で違う画素の割合が cellThreshold を超えたマスを「違うマス」とする（既定 0 = 1 画素でも違えば違う）。
ignoreCells（[[x, y], ...]）と ignoreRects（[[x, y, w, h], ...] 画素単位）は比べない。
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image

CELL = 16


def load(p) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)


def overlay_cells(img: np.ndarray, base: np.ndarray, cell: int = CELL) -> set:
    h, w = min(img.shape[0], base.shape[0]), min(img.shape[1], base.shape[1])
    d = np.abs(img[:h, :w] - base[:h, :w]).max(axis=2) > 24
    out = set()
    for cy in range(0, h, cell):
        for cx in range(0, w, cell):
            if d[cy:cy + cell, cx:cx + cell].sum() > 8:
                out.add((cx // cell, cy // cell))
    return out


def compare(a_path, b_path, diff_path: pathlib.Path, opts: dict | None = None, base_a=None, base_b=None) -> dict:
    """a = AdvanceMap、b = ZigzaguMap。結果の dict と差分画像（diff_path）を作る。"""
    opts = opts or {}
    mode = opts.get("mode", "gba")
    if mode == "overlayCells":
        return _compare_overlay(a_path, b_path, base_a, base_b, diff_path, opts)
    tol = int(opts.get("tolerance", 0 if mode == "gba" else 24))
    cell = int(opts.get("cell", CELL))
    thr = float(opts.get("cellThreshold", 0.0))
    a, b = load(a_path), load(b_path)
    res = {"sizeA": [a.shape[1], a.shape[0]], "sizeB": [b.shape[1], b.shape[0]], "mode": mode}
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    aa, bb = a[:h, :w], b[:h, :w]
    cellmean = mode == "cellMean"
    if mode == "gba":
        d = np.abs((aa >> 3) - (bb >> 3)).max(axis=2) > tol
    elif cellmean:
        tol = int(opts.get("tolerance", 12))
        d = np.zeros((h, w), bool)
        for cy in range(0, h, cell):
            for cx in range(0, w, cell):
                ma = aa[cy:cy + cell, cx:cx + cell].reshape(-1, 3).mean(axis=0)
                mb = bb[cy:cy + cell, cx:cx + cell].reshape(-1, 3).mean(axis=0)
                if np.abs(ma - mb).max() > tol:
                    d[cy:cy + cell, cx:cx + cell] = True
    else:
        d = np.abs(aa - bb).max(axis=2) > tol
    mask = np.ones((h, w), bool)
    for x, y in opts.get("ignoreCells", []):
        mask[y * cell:(y + 1) * cell, x * cell:(x + 1) * cell] = False
    for x, y, rw, rh in opts.get("ignoreRects", []):
        mask[y:y + rh, x:x + rw] = False
    d &= mask
    cells = []
    for cy in range(0, h, cell):
        for cx in range(0, w, cell):
            blk = d[cy:cy + cell, cx:cx + cell]
            m = mask[cy:cy + cell, cx:cx + cell]
            n = int(blk.sum())
            tot = int(m.sum()) or 1
            if n and n / tot > thr:
                cells.append([cx // cell, cy // cell])
    res["diffPixels"] = int(d.sum())
    res["diffCells"] = len(cells)
    res["cells"] = cells[:200]
    res["sameSize"] = a.shape == b.shape
    res["ok"] = res["sameSize"] and not cells
    _diff_image(aa, bb, d, cells, cell, diff_path, a, b)
    return res


def _compare_overlay(a_path, b_path, base_a, base_b, diff_path, opts):
    cell = int(opts.get("cell", CELL))
    a, b = load(a_path), load(b_path)
    res = {"sizeA": [a.shape[1], a.shape[0]], "sizeB": [b.shape[1], b.shape[0]], "mode": "overlayCells"}
    if base_a is None or base_b is None:
        raise ValueError("overlayCells にはブロックだけの画像が要る")
    ca, cb = overlay_cells(a, load(base_a), cell), overlay_cells(b, load(base_b), cell)
    only_a, only_b = sorted(ca - cb), sorted(cb - ca)
    res.update(overlayA=len(ca), overlayB=len(cb), onlyA=[list(c) for c in only_a][:100], onlyB=[list(c) for c in only_b][:100])
    res["cells"] = [list(c) for c in sorted(set(only_a) | set(only_b))][:200]
    res["diffCells"] = len(set(only_a) | set(only_b))
    res["diffPixels"] = 0
    res["sameSize"] = a.shape == b.shape
    res["ok"] = res["sameSize"] and not res["diffCells"]
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    d = np.zeros((h, w), bool)
    for x, y in res["cells"]:
        d[y * cell:(y + 1) * cell, x * cell:(x + 1) * cell] = True
    _diff_image(a[:h, :w], b[:h, :w], d, res["cells"], cell, diff_path, a, b)
    return res


def _diff_image(aa, bb, d, cells, cell, out: pathlib.Path, a_full, b_full):
    """左: AdvanceMap、中: ZigzaguMap、右: 差分（違う画素を赤、違うマスを黄の枠、他は暗く）。"""
    h, w = d.shape
    base = (bb.astype(np.float32) * 0.35).astype(np.uint8)
    base[d] = (255, 0, 64)
    img = Image.fromarray(base, "RGB")
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    for cx, cy in cells:
        dr.rectangle([cx * cell, cy * cell, cx * cell + cell - 1, cy * cell + cell - 1], outline=(255, 220, 0))
    A = Image.fromarray(a_full.astype(np.uint8), "RGB")
    B = Image.fromarray(b_full.astype(np.uint8), "RGB")
    gap = 8
    W = A.width + B.width + img.width + gap * 2
    H = max(A.height, B.height, img.height)
    sheet = Image.new("RGB", (W, H), (128, 128, 128))
    sheet.paste(A, (0, 0))
    sheet.paste(B, (A.width + gap, 0))
    sheet.paste(img, (A.width + B.width + gap * 2, 0))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
