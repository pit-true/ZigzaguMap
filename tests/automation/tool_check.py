"""Phase5 の描く道具と表示（列 1: #388〜#391）を、素の ROM の写しで確かめる。

  python tests/automation/tool_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <作業フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・画面外。ROM には書き込まない。出力は --work（既定は一時フォルダ）に書く。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - fill: 道具の帯と N・B・S（#388）。マップタブの塗りつぶし（つながり・スタンプのくり返し・3 層の次の番号を書かない）と
    マジック塗り、移動エリアタブの塗りつぶし（移動許可だけで見る）とマジック塗り、隣の帯の上の塗りつぶし（そのマップの中だけ）。
    どれも 1 回で戻る。鉛筆に戻すと Ctrl＋左ドラッグの矩形塗りが今のまま。塗って出力し、読み直して同じになる。
  - line: Shift を押しながらの直線（#389）。鉛筆と移動エリアで、描き始めの向きの軸の上だけに描き、1 回で戻る。
  - smartPath: スマートパス（#389）。池（岩の岸）の 3×3 を選んで描くと、周りに合わせた角と辺になる。3×3 でなければふつうの鉛筆。
  - shift: マップシフト（#390）。ドラッグした量だけずらし（はみ出た分は反対側）、1 回で戻る。Shift で横か縦だけ。Esc でやめる。
    移動エリアタブでも同じ。出力して読み直すと同じになる。
  - resize: 対話式リサイズ（#390）。窓で幅・高さ・位置・埋め方を決めて広げると、イベントと接続（相手の逆の接続も）がずれずに付いてくる。
    1 回で戻る。上限を超えると実行しない。出力して読み直すと同じになる。
  - view: 表示の補助（#391）。カーソルの枠（C）・プレイヤーの視界の枠（V）・グリッドの設定・移動許可の数値の欄。既定はどれもオフか
    今の見た目で、切り替えは同じプロフィールで起動し直しても残る。
  - brush: ブラシの大きさと形・ミキシングバッグの重み（Phase7 #515）。] [ で大きさを変え、3×3 の正方形で 9 マス・円で 5 マス変わり、
    1 回で戻る。ドラッグ・Shift の直線もブラシの幅で 1 回の操作。スタンプは今のまま。隣の帯の上でも描ける。カーソルの枠は形に合わせる。
    移動エリアでも使える。袋の重みで出る割合が変わる（ホイールと数字キーで変わる）。出力して読み直すと同じ。
  - select: 範囲を選んで動かす道具（Phase7 #516）。M で選択の道具。左ドラッグで選び、範囲の中のドラッグでブロックと移動許可を動かす
    （跡は選んでいるブロック、イベントは動かさない、端で止める）。1 回で戻る。Esc・範囲の外のクリック・道具の切り替えで外す。
    帯の上では選べない。移動エリアタブでも同じ。出力して読み直すと同じ。
  - shortcuts: ショートカットの変更（#392）。窓でキーを変えるとすぐ使え、前のキーは効かなくなる。重なると聞き、答えた方に残る。
    同じプロフィールで起動し直しても残り、既定に戻せる。
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import shutil
import sys
import tempfile
import time
from collections import deque

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
PRIMARY = 0x08298B44


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_png(data, path: pathlib.Path) -> None:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    path.write_bytes(base64.b64decode(png))


def screenshot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / name)


def canvas(z: Zigzagu, shots: pathlib.Path | None, name: str, target: str) -> None:
    if shots:
        save_png(z.call({"cmd": "canvasPng", "target": target}), shots / name)


def history(z: Zigzagu) -> int:
    return z.call({"cmd": "state"})["history"]


def flood(cells: list[int], w: int, h: int, sx: int, sy: int, key) -> set[tuple[int, int]]:
    """上下左右につながった同じマス（Python で数えた答え）。"""
    target = key(cells[sy * w + sx])
    seen = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        x, y = q.popleft()
        for nx, ny in ((x, y - 1), (x, y + 1), (x - 1, y), (x + 1, y)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and key(cells[ny * w + nx]) == target:
                seen.add((nx, ny))
                q.append((nx, ny))
    return seen


def block(v: int) -> int:
    return v & 0x3FF


def movement(v: int) -> int:
    return v >> 10


def changed(before: list[int], after: list[int], w: int) -> set[tuple[int, int]]:
    return {(i % w, i // w) for i, (a, b) in enumerate(zip(before, after)) if a != b}


def make_triple(z: Zigzagu, n: int) -> None:
    info = z.call({"cmd": "blockInfo", "block": n})
    attr = (info["attribute"] & 0x0FFFFFFF) | 0x30000000
    z.call({"cmd": "command", "name": "setBlock", "args": {"tileset": PRIMARY, "secondary": False, "block": n, "attribute": attr}})


def check_fill(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    st = z.call({"cmd": "tool.state"})
    check(st["tool"] == "pencil" and st["buttons"] == ["pencil"], f"既定の道具は鉛筆（{st}）")
    check(st["strips"] == {"map": True, "movement": True}, "マップタブと移動エリアタブに道具の帯がある")
    z.call({"cmd": "key", "key": "b"})
    st = z.call({"cmd": "tool.state"})
    check(st["tool"] == "fill" and st["buttons"] == ["fill"], f"B で塗りつぶしになり、帯のボタンも変わる（{st['tool']}）")
    screenshot(z, shots, "tool_strip_map.png")

    base = z.call({"cmd": "cells"})
    w, h, cells = base["width"], base["height"], base["cells"]
    # 押すマス: いちばん広い同じブロックのまとまりの 1 マス（家や木などの小さいものでなく、地面）
    sx, sy = 5, 10
    expect = flood(cells, w, h, sx, sy, block)
    new = 0x0D if block(cells[sy * w + sx]) != 0x0D else 0x0E
    z.call({"cmd": "selectBlock", "block": new})
    hist = history(z)
    r = z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    got = changed(cells, after, w)
    check(got == expect, f"塗りつぶしは押したマスとつながった同じブロックだけ（{len(got)} / {len(expect)} マス）")
    check(all(block(after[y * w + x]) == new and movement(after[y * w + x]) == movement(cells[y * w + x]) for x, y in expect), "塗ったマスは選んだブロックで、移動許可は今のまま")
    check(history(z) == hist + 1, "1 回の塗りは 1 回の操作")
    check(str(len(expect)) in r["status"]["left"], f"ステータスバーに塗ったマスの数（{r['status']['left']}）")
    canvas(z, shots, "tool_fill_map.png", "map")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "1 回の Ctrl+Z で戻る")

    # マジック塗り（Ctrl＋クリック）: つながっていない同じブロックも全部
    target = block(cells[sy * w + sx])
    every = {(i % w, i // w) for i, v in enumerate(cells) if block(v) == target}
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy], "ctrl": True})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) == every, f"マジック塗りはマップの中の同じブロックを全部（{len(every)} マス）")
    check(history(z) == hist + 1, "マジック塗りも 1 回の操作")
    z.call({"cmd": "undo"})

    # スタンプ（2×2）: 押したマスを左上にしてくり返す
    stamp = [0x0D, 0x0E, 0x0F, 0x10]
    z.call({"cmd": "selectBlock", "blocks": stamp, "width": 2})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    ok = all(block(after[y * w + x]) == stamp[((y - sy) % 2) * 2 + (x - sx) % 2] for x, y in expect)
    check(ok and changed(cells, after, w) <= expect, "スタンプは押したマスを左上にして柄をくり返す")
    z.call({"cmd": "undo"})

    # 3 層の次の番号は書かない
    make_triple(z, 0x0D)
    z.call({"cmd": "selectBlock", "blocks": [0x0D, 0x0E], "width": 2})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    check(all(block(after[y * w + x]) != 0x0E for x, y in expect) and any(block(after[y * w + x]) == 0x0D for x, y in expect), "3 層の次の番号（0x00E）は塗らない")
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "戻すと元のまま")

    # 隣の帯の上（上の 1 番道路 3.19）: そのマップの中だけ塗る（主マップは変わらない）
    route = z.call({"cmd": "cells", "bank": 3, "map": 19})
    z.call({"cmd": "selectBlock", "block": 0x0D})
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, -1]})
    route2 = z.call({"cmd": "cells", "bank": 3, "map": 19})
    dirty = z.call({"cmd": "state"})["dirty"]
    check(route2["cells"] != route["cells"] and z.call({"cmd": "cells"})["cells"] == cells, "帯の上の塗りつぶしは隣のマップだけ変える")
    check("3.19" in dirty and "3.0" not in dirty, f"未出力の印は隣のマップだけ（{dirty}）")
    check(history(z) == hist + 1, "帯の上の塗りつぶしも 1 回の操作")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells", "bank": 3, "map": 19})["cells"] == route["cells"], "帯の上の塗りつぶしも 1 回で戻る")

    # 移動エリアタブ: 移動許可だけで見る
    z.call({"cmd": "tab", "name": "movement"})
    mexp = flood(cells, w, h, sx, sy, movement)
    newm = 0x01 if movement(cells[sy * w + sx]) != 0x01 else 0x0C
    z.call({"cmd": "selectMovement", "value": newm})
    hist = history(z)
    z.call({"cmd": "mouse", "target": "movement", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) == mexp, f"移動エリアの塗りつぶしは同じ移動許可のつながり（{len(mexp)} マス）")
    check(all(block(after[i]) == block(cells[i]) for i in range(len(cells))), "移動エリアの塗りつぶしはブロックを変えない")
    check(history(z) == hist + 1, "移動エリアの塗りつぶしも 1 回の操作")
    canvas(z, shots, "tool_fill_movement.png", "movement")
    screenshot(z, shots, "tool_strip_movement.png")
    z.call({"cmd": "undo"})
    mevery = {(i % w, i // w) for i, v in enumerate(cells) if movement(v) == movement(cells[sy * w + sx])}
    z.call({"cmd": "mouse", "target": "movement", "action": "click", "cell": [sx, sy], "ctrl": True})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) == mevery, f"移動エリアのマジック塗り（{len(mevery)} マス）")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "移動エリアも 1 回で戻る")

    # 鉛筆に戻すと、Ctrl＋左ドラッグの矩形塗りが今のまま
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "key", "key": "n"})
    check(z.call({"cmd": "tool.state"})["tool"] == "pencil", "N で鉛筆に戻る")
    z.call({"cmd": "selectBlock", "block": 0x0D})
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [4, 3]})
    after = z.call({"cmd": "cells"})["cells"]
    rect = {(x, y) for x in range(2, 5) for y in range(2, 4)}
    check({p for p in changed(cells, after, w)} <= rect and all(block(after[y * w + x]) == 0x0D for x, y in rect), "鉛筆の Ctrl＋左ドラッグは矩形塗りのまま")
    check(history(z) == hist + 1, "矩形塗りも 1 回の操作")
    z.call({"cmd": "undo"})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) <= {(sx, sy)}, "鉛筆の左クリックは 1 マスだけ")
    z.call({"cmd": "undo"})

    # 帯のボタンで切り替え、個人設定に覚える
    z.call({"cmd": "click", "id": "tools.movement.fill"})
    check(z.call({"cmd": "tool.state"})["tool"] == "fill", "帯のボタンで切り替わる")
    check(z.call({"cmd": "state"})["settings"]["paintTool"] == "fill", "今の道具を個人設定に覚える")

    # 塗って出力し、読み直して同じになる
    z.call({"cmd": "selectBlock", "block": new})
    z.call({"cmd": "tool.fill", "cell": [sx, sy], "tab": "map"})
    painted = z.call({"cmd": "cells"})["cells"]
    out = ctx["work"] / "fill_export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(out)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check(z.call({"cmd": "cells"})["cells"] == painted, "出力して読み直すと塗った配置になる")


def check_line(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    base = z.call({"cmd": "cells"})
    w, cells = base["width"], base["cells"]
    z.call({"cmd": "selectBlock", "block": 0x0D})
    hist = history(z)
    # 斜めにドラッグしても、最初に動いた向き（横）の軸の上だけ
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "shift": True, "cell": [3, 3], "to": [9, 5], "steps": 6})
    after = z.call({"cmd": "cells"})["cells"]
    row = {(x, 3) for x in range(3, 10)}
    got = changed(cells, after, w)
    check(got <= row and all(block(after[3 * w + x]) == 0x0D for x in range(3, 10)), f"Shift＋ドラッグで横の直線（{sorted(got)}）")
    check(history(z) == hist + 1, "直線も 1 回の操作")
    canvas(z, shots, "tool_line_map.png", "map")
    z.call({"cmd": "undo"})
    # 縦（最初に下へ動く）
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "shift": True, "cell": [12, 3], "to": [14, 9], "steps": 6})
    after = z.call({"cmd": "cells"})["cells"]
    col = {(12, y) for y in range(3, 10)}
    got = changed(cells, after, w)
    check(got <= col and all(block(after[y * w + 12]) == 0x0D for y in range(3, 10)), f"縦の直線（{sorted(got)}）")
    z.call({"cmd": "undo"})
    # Shift なしは今までどおり通ったマスだけ（直線にしない）
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [3, 3], "to": [9, 5], "steps": 6})
    after = z.call({"cmd": "cells"})["cells"]
    check(not changed(cells, after, w) <= row, "Shift なしのドラッグは軸に固定しない")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "戻すと元のまま")
    # 移動エリア
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "selectMovement", "value": 0x01})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "shift": True, "cell": [3, 3], "to": [9, 5], "steps": 6})
    after = z.call({"cmd": "cells"})["cells"]
    got = changed(cells, after, w)
    check(got <= row and all(movement(after[3 * w + x]) == 1 for x in range(3, 10)), f"移動エリアでも横の直線（{sorted(got)}）")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "移動エリアの直線も 1 回で戻る")


POND = [0x120, 0x123, 0x121, 0x12A, 0x12B, 0x12C, 0x132, 0x133, 0x134]


def check_smart_path(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    base = z.call({"cmd": "cells"})
    w, cells = base["width"], base["cells"]
    z.call({"cmd": "selectBlock", "blocks": POND, "width": 3})
    st = z.call({"cmd": "tool.set", "smartPath": True})
    check(st["smartPath"] and st["smartPathReady"], "3×3 を選んでスマートパスをオンにすると使える")
    hist = history(z)
    for y in (12, 13, 14):
        z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [9, y], "to": [13, y], "steps": 4})
    after = z.call({"cmd": "cells"})["cells"]
    rows = [[block(after[y * w + x]) for x in range(9, 14)] for y in (12, 13, 14)]
    check(rows[0] == [0x120, 0x123, 0x123, 0x123, 0x121], f"上の辺と角（{[hex(b) for b in rows[0]]}）")
    check(rows[1] == [0x12A, 0x12B, 0x12B, 0x12B, 0x12C], f"中と左右の辺（{[hex(b) for b in rows[1]]}）")
    check(rows[2] == [0x132, 0x133, 0x133, 0x133, 0x134], f"下の辺と角（{[hex(b) for b in rows[2]]}）")
    check(changed(cells, after, w) <= {(x, y) for x in range(9, 14) for y in range(12, 15)}, "描いた範囲の外は変えない")
    check(history(z) == hist + 3, "1 回のドラッグで 1 回の操作")
    canvas(z, shots, "tool_smartpath_map.png", "map")
    screenshot(z, shots, "tool_smartpath.png")
    for _ in range(3):
        z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "3 回の Ctrl+Z で元に戻る")
    # 塗りつぶしでも使える（つながった地面の範囲を池にする）
    z.call({"cmd": "tool.set", "tool": "fill"})
    sx, sy = 5, 10
    region = flood(cells, w, base["height"], sx, sy, block)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [sx, sy]})
    after = z.call({"cmd": "cells"})["cells"]
    used = {block(after[y * w + x]) for x, y in region}
    check(used <= set(POND) and 0x12B in used and len(used) > 1, f"塗りつぶしでも周りに合わせて縁を選ぶ（{sorted(hex(b) for b in used)}）")
    canvas(z, shots, "tool_smartpath_fill.png", "map")
    z.call({"cmd": "undo"})
    z.call({"cmd": "tool.set", "tool": "pencil"})
    # 3×3 でなければふつうの鉛筆
    z.call({"cmd": "selectBlock", "block": 0x0D})
    check(z.call({"cmd": "tool.state"})["smartPathReady"] is False, "3×3 でなければスマートパスは使えない")
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [9, 12]})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) <= {(9, 12)} and block(after[12 * w + 9]) == 0x0D, "3×3 でなければふつうの鉛筆で 1 マス")
    z.call({"cmd": "undo"})


def shifted(cells: list[int], w: int, h: int, dx: int, dy: int) -> list[int]:
    out = [0] * len(cells)
    for y in range(h):
        for x in range(w):
            out[((y + dy) % h) * w + (x + dx) % w] = cells[y * w + x]
    return out


def check_shift(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    base = z.call({"cmd": "cells"})
    w, h, cells = base["width"], base["height"], base["cells"]
    events = z.call({"cmd": "event.state"})
    z.call({"cmd": "key", "key": "s"})
    check(z.call({"cmd": "tool.state"})["tool"] == "shift", "S でマップシフトになる")
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "down", "cell": [5, 5]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "button": "left", "cell": [7, 4]})
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "tool_shift_preview.png")
    status = z.call({"cmd": "state"})["status"]["left"]
    z.call({"cmd": "mouse", "target": "map", "action": "up", "cell": [7, 4]})
    after = z.call({"cmd": "cells"})["cells"]
    check(after == shifted(cells, w, h, 2, -1), f"ドラッグした量（横 +2・縦 -1）だけずれ、はみ出た分は反対側に出る（{status}）")
    check(history(z) == hist + 1, "マップシフトは 1 回の操作")
    ev = z.call({"cmd": "event.state"})
    check(ev.get("events") == events.get("events"), "イベントは動かない")
    canvas(z, shots, "tool_shift_map.png", "map")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "1 回の Ctrl+Z で戻る")
    # Shift で横だけ
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "shift": True, "cell": [5, 5], "to": [8, 6], "steps": 3})
    check(z.call({"cmd": "cells"})["cells"] == shifted(cells, w, h, 3, 0), "Shift を押しながらでは横だけずらす")
    z.call({"cmd": "undo"})
    # Esc でやめる
    z.call({"cmd": "mouse", "target": "map", "action": "down", "cell": [5, 5]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "button": "left", "cell": [9, 9]})
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "mouse", "target": "map", "action": "up", "cell": [9, 9]})
    check(z.call({"cmd": "cells"})["cells"] == cells and history(z) == hist, "Esc でやめると何も変わらない")
    # 移動エリアタブでも
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "cell": [5, 5], "to": [4, 7], "steps": 3})
    check(z.call({"cmd": "cells"})["cells"] == shifted(cells, w, h, -1, 2), "移動エリアタブでもずらせる（ブロックと移動許可が一緒に動く）")
    canvas(z, shots, "tool_shift_movement.png", "movement")
    # 出力して読み直す
    painted = z.call({"cmd": "cells"})["cells"]
    out = ctx["work"] / "shift_export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(out)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check(z.call({"cmd": "cells"})["cells"] == painted, "出力して読み直すとずらした配置になる")


def check_resize(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    base = z.call({"cmd": "cells"})
    w, h, cells, border = base["width"], base["height"], base["cells"], base["border"]
    persons = [(p["x"], p["y"]) for p in z.call({"cmd": "event.state"})["events"]["persons"]]
    conns = z.call({"cmd": "neighbors.state"})["connections"]
    hist = history(z)
    # 窓を開いて決める（左に 2・上に 1 足して幅 +1・高さ +1。右は 1 削る）
    r = z.call({"cmd": "tool.resizeDialog"})
    check(any(d.get("title") == "マップの大きさと位置" for d in r["dialogs"]), "窓が開く")
    z.call({"cmd": "setField", "id": "resize.width", "value": str(w + 1)})
    z.call({"cmd": "setField", "id": "resize.height", "value": str(h + 1)})
    z.call({"cmd": "setField", "id": "resize.left", "value": "2"})
    z.call({"cmd": "setField", "id": "resize.top", "value": "1"})
    z.call({"cmd": "setField", "id": "resize.fill", "value": 1})
    info = z.call({"cmd": "getField", "id": "resize.info"})["value"]
    check("左 +2" in info and "右 -1" in info and "上 +1" in info, f"変わる量を出す（{info}）")
    if shots:
        save_png(z.call({"cmd": "ui.shot", "id": "resize.view"}), shots / "tool_resize_view.png")
        screenshot(z, shots, "tool_resize_dialog.png")
    z.call({"cmd": "dialog", "press": "ok"})
    after = z.call({"cmd": "cells"})
    check((after["width"], after["height"]) == (w + 1, h + 1), f"大きさが変わる（{after['width']}×{after['height']}）")
    check(after["cells"][1 * (w + 1) + 2] == cells[0], "元の左上は (2, 1) へ")
    bw = len(border) and int(len(border) ** 0.5)
    check(after["cells"][0] == border[0] and after["cells"][1] == border[1 % bw], "広げた所は境界ブロック（できあがりの座標でそろう）")
    moved = [(p["x"], p["y"]) for p in z.call({"cmd": "event.state"})["events"]["persons"]]
    check(moved == [(x + 2, y + 1) for x, y in persons], "人のイベントも一緒にずれる")
    conns2 = z.call({"cmd": "neighbors.state"})["connections"]
    vert = [(a["offset"], b["offset"]) for a, b in zip(conns, conns2) if a["direction"] in (1, 2)]
    check(all(b == a + 2 for a, b in vert) and len(vert) > 0, f"上下の接続のずれに 2 を足す（{vert}）")
    check(history(z) == hist + 1, "1 回の操作")
    canvas(z, shots, "tool_resize_map.png", "map")
    # 相手の逆の接続もそろう（1 番道路 3.19 の下の接続）
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    back = [c for c in z.call({"cmd": "neighbors.state"})["connections"] if c["bank"] == 3 and c["map"] == 0]
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    up = [c for c in conns2 if c["bank"] == 3 and c["map"] == 19]
    check(len(back) == 1 and len(up) == 1 and back[0]["offset"] == -up[0]["offset"], f"相手の逆の接続もそろう（{back} / {up}）")
    resized = z.call({"cmd": "cells"})["cells"]
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells and z.call({"cmd": "neighbors.state"})["connections"] == conns, "1 回の Ctrl+Z で大きさ・イベント・接続が戻る")
    z.call({"cmd": "redo"})
    # 出力して読み直す
    out = ctx["work"] / "resize_export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(out)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check(z.call({"cmd": "cells"})["cells"] == resized, "出力して読み直すと変えた配置になる")
    # 上限を超えると実行しない
    r = z.call({"cmd": "tool.resize", "left": 0, "right": 500, "up": 0, "down": 0})
    check(r["done"] is False and any(d.get("kind") == "app" for d in r["dialogs"]), "上限を超えると実行せず、理由を出す")
    for d in r["dialogs"]:
        z.call({"cmd": "dialog", "press": "ok"})


def check_view(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    a = z.call({"cmd": "view.aids"})
    check(not a["cursorFrame"] and not a["playerView"] and not a["grid"], "既定はカーソルの枠・視界の枠・グリッドがどれもオフ")
    check(a["gridStyle"] == {"width": 1, "height": 1, "offsetX": 0, "offsetY": 0, "color": "#000000", "line": "solid"}, "グリッドの形の既定は今の見た目")
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [5, 5]})
    check(z.call({"cmd": "view.aids"})["layers"]["map"]["cursor"] is None, "オフのときは枠を出さない")
    # C でカーソルの枠
    z.call({"cmd": "key", "key": "c"})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [5, 5]})
    a = z.call({"cmd": "view.aids"})
    check(a["cursorFrame"] and a["layers"]["map"]["cursor"] == {"x": 5, "y": 5, "width": 1, "height": 1}, f"C でカーソルの枠（{a['layers']['map']['cursor']}）")
    z.call({"cmd": "selectBlock", "blocks": [1, 2, 3, 4, 5, 6], "width": 3})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [6, 7]})
    c = z.call({"cmd": "view.aids"})["layers"]["map"]["cursor"]
    check(c == {"x": 6, "y": 7, "width": 3, "height": 2}, f"スタンプのときは選択の大きさの枠（{c}）")
    # V で視界の枠
    z.call({"cmd": "key", "key": "v"})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [10, 8]})
    sight = z.call({"cmd": "view.aids"})["layers"]["map"]["sight"]
    check(sight == {"x": 3, "y": 3.5, "width": 15, "height": 10}, f"V で実機の15×10マスの視界の枠（主人公のマス左上は112,72px。{sight}）")
    screenshot(z, shots, "tool_view_frames.png")
    # イベントタブと移動エリアタブでも
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "mouse", "target": "event", "action": "hover", "cell": [4, 4]})
    ev = z.call({"cmd": "view.aids"})["layers"]["event"]
    check(ev["cursor"] == {"x": 4, "y": 4, "width": 1, "height": 1} and ev["sight"] is not None, "イベントタブでも枠が出る")
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "mouse", "target": "movement", "action": "hover", "cell": [2, 3]})
    mv = z.call({"cmd": "view.aids"})["layers"]["movement"]
    check(mv["cursor"] == {"x": 2, "y": 3, "width": 1, "height": 1}, "移動エリアタブでも枠が出る")
    # 移動許可の数値の欄
    check(z.call({"cmd": "view.aids"})["movementValue"] == "00", "移動許可の数値の欄は今の値（00）")
    z.call({"cmd": "setField", "id": "movement.value", "value": "1a"})
    check(z.call({"cmd": "selection"})["movement"] == 0x1A, "16 進で入れると移動許可の選択が変わる")
    z.call({"cmd": "setField", "id": "movement.value", "value": "4F"})
    check(z.call({"cmd": "selection"})["movement"] == 0x1A, "00〜3F の外は選択を変えない")
    z.call({"cmd": "mouse", "target": "movementPalette", "action": "click", "cell": [0, 5]})
    check(z.call({"cmd": "view.aids"})["movementValue"] == "05", "パレットで選ぶと欄の値も変わる")
    # 打っている途中の 1 桁では選ばない（「4F」の「4」で 04 にならない。#406）。Enter か欄を離れると 1 桁のまま選ぶ
    z.call({"cmd": "ui.type", "id": "movement.value", "text": "2", "blur": False})
    check(z.call({"cmd": "selection"})["movement"] == 0x05, "1 桁の途中では選択を変えない")
    z.call({"cmd": "key", "id": "movement.value", "key": "Enter"})
    check(z.call({"cmd": "selection"})["movement"] == 0x02, "1 桁のまま Enter で選ぶ（02）")
    z.call({"cmd": "setField", "id": "movement.value", "value": "3"})
    check(z.call({"cmd": "selection"})["movement"] == 0x03, "1 桁のまま欄を離れると選ぶ（03）")
    screenshot(z, shots, "tool_view_movement.png")
    # グリッドの設定
    z.call({"cmd": "tab", "name": "map"})
    before = z.call({"cmd": "canvasPng", "target": "map"})
    z.call({"cmd": "action", "id": "view.gridSettings"})
    z.call({"cmd": "setField", "id": "grid.width", "value": "2"})
    z.call({"cmd": "setField", "id": "grid.height", "value": "3"})
    z.call({"cmd": "setField", "id": "grid.offsetX", "value": "1"})
    z.call({"cmd": "setField", "id": "grid.color", "value": "#ff0000"})
    z.call({"cmd": "setField", "id": "grid.line", "value": 1})
    screenshot(z, shots, "tool_view_grid_dialog.png")
    z.call({"cmd": "dialog", "press": "ok"})
    a = z.call({"cmd": "view.aids"})
    check(a["grid"] and a["gridStyle"] == {"width": 2, "height": 3, "offsetX": 1, "offsetY": 0, "color": "#ff0000", "line": "dashed"}, f"OK でグリッドを出して形を覚える（{a['gridStyle']}）")
    canvas(z, shots, "tool_view_grid.png", "map")
    check(z.call({"cmd": "canvasPng", "target": "map"}) != before, "グリッドが描かれる")
    # キャンセルは元に戻す
    z.call({"cmd": "action", "id": "view.gridSettings"})
    z.call({"cmd": "setField", "id": "grid.width", "value": "5"})
    z.call({"cmd": "dialog", "press": "cancel"})
    check(z.call({"cmd": "view.aids"})["gridStyle"]["width"] == 2, "キャンセルでは変えない")
    # Ctrl+G の切り替えは今のまま
    z.call({"cmd": "key", "key": "g", "ctrl": True})
    check(z.call({"cmd": "view.aids"})["grid"] is False, "Ctrl+G でグリッドを隠せる")
    ctx["viewProfileCheck"] = True


def check_view_persist(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    a = z.call({"cmd": "view.aids"})
    check(a["cursorFrame"] and a["playerView"] and a["gridStyle"]["width"] == 2 and a["gridStyle"]["line"] == "dashed", "切り替えとグリッドの形は起動し直しても残る")



def check_brush(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    base = z.call({"cmd": "cells"})
    w, cells = base["width"], base["cells"]
    st = z.call({"cmd": "tool.state"})
    check(st["brushSize"] == 1 and st["brushShape"] == "square" and st["brushActive"] == {"map": False, "movement": False}, f"既定のブラシは 1×1 の正方形（{st['brushSize']} {st['brushShape']}）")
    z.call({"cmd": "key", "key": "["})
    check(z.call({"cmd": "tool.state"})["brushSize"] == 1, "[ で 1 より小さくならない")
    z.call({"cmd": "key", "key": "]"})
    z.call({"cmd": "key", "key": "]"})
    st = z.call({"cmd": "tool.state"})
    status = z.call({"cmd": "state"})["status"]["left"]
    check(st["brushSize"] == 3 and "ブラシ 3×3" in status, f"] で大きくなり、ステータスバーに出す（{status}）")
    field = z.call({"cmd": "getField", "id": "tools.map.brushSize"})
    check(str(field.get("value")) in ("3", "2", "3×3"), f"帯の欄も 3×3 になる（{field}）")
    z.call({"cmd": "selectBlock", "block": 0x0D})
    check(z.call({"cmd": "tool.state"})["brushActive"]["map"] is True, "1 ブロックを選ぶとブラシを使う")
    # 正方形 3×3: カーソルのマスを真ん中に 9 マス、1 回の操作
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    square = {(x, y) for x in range(9, 12) for y in range(9, 12)}
    check(all(block(after[y * w + x]) == 0x0D for x, y in square) and changed(cells, after, w) <= square, "3×3 の正方形でカーソルのまわり 9 マスに描く")
    check(all(movement(after[y * w + x]) == movement(cells[y * w + x]) for x, y in square), "移動許可は今のまま（移動許可を持たない選択）")
    check(history(z) == hist + 1, "1 回のクリックは 1 回の操作")
    canvas(z, shots, "tool_brush_square.png", "map")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "1 回の Ctrl+Z で戻る")
    # ドラッグ: 通ったマスを真ん中にした帯、1 回の操作
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [5, 5], "to": [9, 5], "steps": 4})
    after = z.call({"cmd": "cells"})["cells"]
    band = {(x, y) for x in range(4, 11) for y in range(4, 7)}
    check(all(block(after[y * w + x]) == 0x0D for x, y in band) and changed(cells, after, w) <= band, "ドラッグはブラシの幅で描く")
    check(history(z) == hist + 1, "1 回のドラッグは 1 回の操作")
    z.call({"cmd": "undo"})
    # Shift の直線もブラシの幅
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "shift": True, "cell": [3, 3], "to": [9, 6], "steps": 6})
    after = z.call({"cmd": "cells"})["cells"]
    line = {(x, y) for x in range(2, 11) for y in range(2, 5)}
    check(changed(cells, after, w) <= line and all(block(after[y * w + x]) == 0x0D for x, y in line), "Shift の直線もブラシの幅（3 行）")
    check(history(z) == hist + 1, "直線も 1 回の操作")
    z.call({"cmd": "undo"})
    # 円 3: 十字の 5 マス。カーソルの枠も形に合わせる
    z.call({"cmd": "tool.set", "brushShape": "circle"})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    plus = {(10, 10), (9, 10), (11, 10), (10, 9), (10, 11)}
    check(changed(cells, after, w) <= plus and all(block(after[y * w + x]) == 0x0D for x, y in plus), "3 の円は十字の 5 マス")
    z.call({"cmd": "undo"})
    z.call({"cmd": "key", "key": "c"})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [10, 10]})
    layer = z.call({"cmd": "view.aids"})["layers"]["map"]
    check(layer["cursor"] == {"x": 9, "y": 9, "width": 3, "height": 3} and layer["cursorCells"] == 5, f"カーソルの枠はブラシの範囲と形（{layer['cursor']}、{layer['cursorCells']} マス）")
    screenshot(z, shots, "tool_brush_cursor.png")
    # スタンプ（複数選択）は今のまま 1 回だけ置く
    z.call({"cmd": "selectBlock", "blocks": [0x0D, 0x0E, 0x0F, 0x10], "width": 2})
    check(z.call({"cmd": "tool.state"})["brushActive"]["map"] is False, "スタンプのときはブラシを使わない")
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) <= {(10, 10), (11, 10), (10, 11), (11, 11)}, "スタンプは押したマスを左上に 1 回だけ置く")
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [10, 10]})
    check(z.call({"cmd": "view.aids"})["layers"]["map"]["cursor"] == {"x": 10, "y": 10, "width": 2, "height": 2}, "スタンプのときの枠は今のまま")
    z.call({"cmd": "undo"})
    # 隣の帯の上（上の 1 番道路 3.19）: 主マップの 0 行と帯の両方に描き、1 回で戻る
    z.call({"cmd": "tool.set", "brushShape": "square"})
    z.call({"cmd": "selectBlock", "block": 0x0D})
    route = z.call({"cmd": "cells", "bank": 3, "map": 19})
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [5, -1]})
    after = z.call({"cmd": "cells"})["cells"]
    route2 = z.call({"cmd": "cells", "bank": 3, "map": 19})
    check(route2["cells"] != route["cells"] and changed(cells, after, w) <= {(4, 0), (5, 0), (6, 0)} and block(after[5]) == 0x0D, "隣の帯の上でもブラシで描ける（主マップの端もまとめて）")
    check(history(z) == hist + 1, "2 枚にまたがっても 1 回の操作")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells and z.call({"cmd": "cells", "bank": 3, "map": 19})["cells"] == route["cells"], "1 回で両方戻る")
    # 移動エリアタブ: 移動許可を 3×3 に書く
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "selectMovement", "value": 0x01})
    check(z.call({"cmd": "tool.state"})["brushActive"]["movement"] is True, "移動エリアタブでもブラシを使う")
    z.call({"cmd": "mouse", "target": "movement", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    check(changed(cells, after, w) <= square and all(movement(after[y * w + x]) == 1 and block(after[y * w + x]) == block(cells[y * w + x]) for x, y in square), "移動エリアでも 3×3 に移動許可だけ書く")
    z.call({"cmd": "undo"})
    z.call({"cmd": "tab", "name": "map"})
    # ミキシングバッグの重み: 9×9 の正方形（81 マス）で割合を見る
    z.call({"cmd": "tool.set", "brushSize": 9})
    grass = [0x0D, 0x0E]
    r = z.call({"cmd": "bag.set", "blocks": grass, "seed": 11, "weights": [1, 9]})
    check(r["weights"] == [1, 9], f"重みを決められる（{r['weights']}）")
    z.call({"cmd": "selectBlock", "block": 0x0D})
    hist = history(z)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    area = [(x, y) for x in range(6, 15) for y in range(6, 15)]
    heavy = sum(1 for x, y in area if block(after[y * w + x]) == 0x0E)
    light = sum(1 for x, y in area if block(after[y * w + x]) == 0x0D)
    check(heavy + light == 81 and heavy > light * 3, f"重み 9 のブロックが多く出る（0x00E {heavy} / 0x00D {light}）")
    check(history(z) == hist + 1, "袋のブラシも 1 回の操作")
    canvas(z, shots, "tool_brush_bag.png", "map")
    painted = after
    z.call({"cmd": "undo"})
    z.call({"cmd": "redo"})
    check(z.call({"cmd": "cells"})["cells"] == painted, "やり直すと同じ絵（選んだ結果は操作に残る）")
    z.call({"cmd": "undo"})
    # 袋の欄のホイールと数字キーで重みを変える
    z.call({"cmd": "mouse", "id": f"map.bag.{0x0D}", "action": "wheel", "px": [8, 8], "delta": -1})
    check(z.call({"cmd": "bag.state"})["weights"] == [2, 9], "ホイールを奥へ回すと重みが 1 増える")
    z.call({"cmd": "mouse", "id": f"map.bag.{0x0E}", "action": "hover", "px": [8, 8]})
    z.call({"cmd": "key", "key": "1"})
    check(z.call({"cmd": "bag.state"})["weights"] == [2, 1], "乗せて数字キーを押すとその重みになる")
    screenshot(z, shots, "tool_brush_bag_weights.png")
    z.call({"cmd": "bag.weight", "block": 0x0D, "weight": 9})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    heavy = sum(1 for x, y in area if block(after[y * w + x]) == 0x0D)
    light = sum(1 for x, y in area if block(after[y * w + x]) == 0x0E)
    check(heavy > light * 3, f"重みを入れ替えると割合も入れ替わる（0x00D {heavy} / 0x00E {light}）")
    painted = after
    # 出力して読み直す
    out = ctx["work"] / "brush_export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(out)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check(z.call({"cmd": "cells"})["cells"] == painted, "出力して読み直すと描いた配置になる")


def check_brush_persist(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    st = z.call({"cmd": "tool.state"})
    check(st["brushSize"] == 9 and st["brushShape"] == "square", f"ブラシの大きさと形は起動し直しても残る（{st['brushSize']}）")
    check(z.call({"cmd": "bag.state"})["blocks"] == [], "袋の中身と重みは残さない")



def moved_grid(cells: list[int], w: int, rect: tuple[int, int, int, int], dx: int, dy: int, fill_block: int) -> list[int]:
    """範囲を動かした答え（跡は fill_block、移動許可はそのマスの今の値）。"""
    x0, y0, rw, rh = rect
    out = list(cells)
    for y in range(y0, y0 + rh):
        for x in range(x0, x0 + rw):
            inside = x0 + dx <= x < x0 + dx + rw and y0 + dy <= y < y0 + dy + rh
            if not inside:
                out[y * w + x] = (cells[y * w + x] & ~0x3FF) | fill_block
    for y in range(y0, y0 + rh):
        for x in range(x0, x0 + rw):
            out[(y + dy) * w + x + dx] = cells[y * w + x]
    return out


def check_select(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "setting", "key": "autoMovement", "value": False})
    base = z.call({"cmd": "cells"})
    w, h, cells = base["width"], base["height"], base["cells"]
    events = z.call({"cmd": "event.state"})
    z.call({"cmd": "key", "key": "m"})
    st = z.call({"cmd": "tool.state"})
    check(st["tool"] == "select" and st["buttons"] == ["select"], f"M で選択の道具になり、帯のボタンも変わる（{st['tool']}）")
    z.call({"cmd": "selectBlock", "block": 0x0D})
    hist = history(z)
    # 左ドラッグで矩形を選ぶ（履歴に入れない）
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [4, 3], "to": [8, 7], "steps": 4})
    sel = z.call({"cmd": "select.state"})
    check(sel["rect"] == [4, 3, 5, 5], f"左ドラッグで矩形を選ぶ（{sel['rect']}）")
    check(history(z) == hist and z.call({"cmd": "cells"})["cells"] == cells, "選ぶだけでは何も変わらず、履歴にも入らない")
    status = z.call({"cmd": "state"})["status"]["left"]
    check("5×5" in status, f"ステータスバーに選んだ大きさ（{status}）")
    # 範囲の中をドラッグして動かす（下見を見てから離す）
    z.call({"cmd": "mouse", "target": "map", "action": "down", "cell": [6, 5]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "button": "left", "cell": [8, 8]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "button": "left", "cell": [9, 11]})
    screenshot(z, shots, "tool_select_preview.png")
    check(z.call({"cmd": "cells"})["cells"] == cells, "ドラッグの間は書かない（下見だけ）")
    z.call({"cmd": "mouse", "target": "map", "action": "up", "cell": [9, 11]})
    after = z.call({"cmd": "cells"})["cells"]
    expect = moved_grid(cells, w, (4, 3, 5, 5), 3, 6, 0x0D)
    check(after == expect, "ブロックと移動許可が動き、跡は選んでいるブロックで埋まる（移動許可はそのマスの今の値）")
    check(history(z) == hist + 1, "1 回の移動は 1 回の操作")
    check(z.call({"cmd": "select.state"})["rect"] == [7, 9, 5, 5], "選択も動かした先に付いていく")
    check(z.call({"cmd": "event.state"}).get("events") == events.get("events"), "イベントは動かさない")
    canvas(z, shots, "tool_select_moved.png", "map")
    screenshot(z, shots, "tool_select_moved_window.png")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == cells, "1 回の Ctrl+Z で戻る")
    z.call({"cmd": "redo"})
    check(z.call({"cmd": "cells"})["cells"] == expect, "やり直すと同じ")
    z.call({"cmd": "undo"})
    # Esc で選択を外す
    z.call({"cmd": "key", "key": "Escape"})
    check(z.call({"cmd": "select.state"})["rect"] is None, "Esc で選択を外す")
    # 範囲の外のクリックで外す
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [2, 2], "to": [4, 4], "steps": 2})
    check(z.call({"cmd": "select.state"})["rect"] == [2, 2, 3, 3], "選び直せる")
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [15, 15]})
    check(z.call({"cmd": "select.state"})["rect"] is None and history(z) == hist, "範囲の外のクリックで外す（何も書かない）")
    # 隣の帯の上では選べない
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [5, -2], "to": [8, 1], "steps": 3})
    check(z.call({"cmd": "select.state"})["rect"] is None, "隣の帯の上からは選べない")
    # 端で止める
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [1, 2], "to": [3, 4], "steps": 2})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [2, 3], "to": [-4, 3], "steps": 3})
    after = z.call({"cmd": "cells"})["cells"]
    check(after == moved_grid(cells, w, (1, 2, 3, 3), -1, 0, 0x0D) and z.call({"cmd": "select.state"})["rect"] == [0, 2, 3, 3], "マップの外へははみ出さない（左端で止める）")
    z.call({"cmd": "undo"})
    r = z.call({"cmd": "select.move", "rect": [0, 0, 3, 3], "dx": 100, "dy": 0})
    check(r["moved"] == [w - 3, 0], f"自動操作の select.move も端で止める（{r['moved']}）")
    z.call({"cmd": "undo"})
    # ドラッグ中の Esc はドラッグだけやめる
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [4, 3], "to": [8, 7], "steps": 2})
    z.call({"cmd": "mouse", "target": "map", "action": "down", "cell": [5, 4]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "button": "left", "cell": [10, 10]})
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "mouse", "target": "map", "action": "up", "cell": [10, 10]})
    check(z.call({"cmd": "cells"})["cells"] == cells and history(z) == hist, "ドラッグ中の Esc でやめると何も変わらない")
    check(z.call({"cmd": "select.state"})["rect"] == [4, 3, 5, 5], "ドラッグをやめても選択は残る")
    # 道具を変えると外す。鉛筆の Ctrl＋左ドラッグは今のまま
    z.call({"cmd": "key", "key": "n"})
    check(z.call({"cmd": "select.state"})["rect"] is None, "道具を変えると選択を外す")
    z.call({"cmd": "key", "key": "m"})
    # 移動エリアタブでも（ブロックと移動許可を一緒に）
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "cell": [4, 3], "to": [8, 7], "steps": 2})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "cell": [6, 5], "to": [9, 11], "steps": 4})
    after = z.call({"cmd": "cells"})["cells"]
    check(after == expect, "移動エリアタブでも同じに動く")
    canvas(z, shots, "tool_select_movement.png", "movement")
    painted = after
    # 出力して読み直す
    out = ctx["work"] / "select_export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(out)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check(z.call({"cmd": "cells"})["cells"] == painted, "出力して読み直すと動かした配置になる")


def shortcut_set(z: Zigzagu, action: str, n: int, key: str, **mods) -> dict:
    slot = f"shortcuts.{action}.{n}"
    z.call({"cmd": "click", "id": slot})
    z.call({"cmd": "key", "id": slot, "key": key, **mods})
    return z.call({"cmd": "dialogs"})


def check_shortcuts(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    st = z.call({"cmd": "shortcuts.state"})
    check(st["keys"]["tool.pencil"] == "N" and st["keys"]["edit.redo"] == "Ctrl+Y、Ctrl+Shift+Z" and st["overrides"] == {}, "既定は今までのキー")
    z.call({"cmd": "action", "id": "opt.shortcuts"})
    # 鉛筆を Q と Alt+N に
    shortcut_set(z, "tool.pencil", 0, "q")
    shortcut_set(z, "tool.pencil", 1, "n", alt=True)
    # カーソルの枠に B（塗りつぶしと重なる）→ 聞かれるので新しい方に残す
    d = shortcut_set(z, "view.cursorFrame", 0, "b")
    asked = [x for x in d.get("dialogs", []) if x.get("title") == "キーの重なり"]
    check(len(asked) == 1, f"重なると聞く（{d}）")
    screenshot(z, shots, "tool_shortcuts_conflict.png")
    z.call({"cmd": "dialog", "press": "new"})
    # グリッドの表示に Ctrl+Shift+G（重ならない）。Ctrl+P（ブロックパレットの横幅）と重ねて、前からの方に残すと変わらない
    shortcut_set(z, "view.grid", 0, "G", ctrl=True, shift=True)
    shortcut_set(z, "view.grid", 1, "p", ctrl=True)
    z.call({"cmd": "dialog", "press": "old"})
    screenshot(z, shots, "tool_shortcuts_dialog.png")
    z.call({"cmd": "dialog", "press": "ok"})
    st = z.call({"cmd": "shortcuts.state"})
    check(st["keys"]["tool.pencil"] == "Q、Alt+N" and st["keys"]["view.cursorFrame"] == "B" and st["keys"]["tool.fill"] == "", f"窓で変えたキー（{st['keys']['tool.pencil']}、{st['keys']['view.cursorFrame']}、{st['keys']['tool.fill']!r}）")
    check(st["keys"]["view.grid"] == "Ctrl+Shift+G" and st["keys"]["view.paletteWidth"] == "Ctrl+P", "前からの方に残すと、そちらは変わらない")
    check(st["overrides"] == {"view.cursorFrame": ["B"], "view.grid": ["Ctrl+Shift+G"], "tool.pencil": ["Q", "Alt+N"], "tool.fill": []}, f"個人設定には変えたものだけ残す（{st['overrides']}）")
    # すぐ使える
    z.call({"cmd": "tool.set", "tool": "shift"})
    z.call({"cmd": "key", "key": "n"})
    check(z.call({"cmd": "tool.state"})["tool"] == "shift", "前のキー（N）では変わらない")
    z.call({"cmd": "key", "key": "q"})
    check(z.call({"cmd": "tool.state"})["tool"] == "pencil", "Q で鉛筆になる")
    z.call({"cmd": "tool.set", "tool": "shift"})
    z.call({"cmd": "key", "key": "n", "alt": True})
    check(z.call({"cmd": "tool.state"})["tool"] == "pencil", "2 つ目のキー（Alt+N）でも鉛筆になる")
    z.call({"cmd": "key", "key": "b"})
    check(z.call({"cmd": "view.aids"})["cursorFrame"] is True and z.call({"cmd": "tool.state"})["tool"] == "pencil", "B はカーソルの枠に変わった（塗りつぶしにならない）")
    z.call({"cmd": "key", "key": "g", "ctrl": True})
    check(z.call({"cmd": "view.aids"})["grid"] is False, "前のキー（Ctrl+G）ではグリッドを出さない")
    z.call({"cmd": "key", "key": "G", "ctrl": True, "shift": True})
    check(z.call({"cmd": "view.aids"})["grid"] is True, "Ctrl+Shift+G でグリッドを出す")
    menu = z.call({"cmd": "menu.list"})
    check("Ctrl+Shift+G" in json.dumps(menu, ensure_ascii=False), "メニューの表記も変わる")


def check_shortcuts_persist(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    st = z.call({"cmd": "shortcuts.state"})
    check(st["keys"]["tool.pencil"] == "Q、Alt+N" and st["keys"]["view.grid"] == "Ctrl+Shift+G", "起動し直しても残る")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "tool.set", "tool": "fill"})
    z.call({"cmd": "key", "key": "q"})
    check(z.call({"cmd": "tool.state"})["tool"] == "pencil", "起動し直しても Q で鉛筆になる")
    z.call({"cmd": "action", "id": "opt.shortcuts"})
    z.call({"cmd": "click", "id": "shortcuts.reset"})
    z.call({"cmd": "dialog", "press": "ok"})
    st = z.call({"cmd": "shortcuts.state"})
    check(st["overrides"] == {} and st["keys"]["tool.pencil"] == "N" and st["keys"]["view.grid"] == "Ctrl+G", "既定に戻せる")
    z.call({"cmd": "key", "key": "b"})
    check(z.call({"cmd": "tool.state"})["tool"] == "fill", "既定に戻すと B で塗りつぶしになる")


CHECKS = {
    "fill": check_fill,
    "line": check_line,
    "smartPath": check_smart_path,
    "shift": check_shift,
    "resize": check_resize,
    "view": check_view,
    "brush": check_brush,
    "select": check_select,
    "shortcuts": check_shortcuts,
}

# 同じプロフィールで起動し直して確かめるもの
PERSIST = {
    "view": check_view_persist,
    "brush": check_brush_persist,
    "shortcuts": check_shortcuts_persist,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--work")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-toolw-", ignore_cleanup_errors=True) as tmpwork:
        work = pathlib.Path(a.work) if a.work else pathlib.Path(tmpwork)
        work.mkdir(parents=True, exist_ok=True)
        ctx = {"rom": a.rom, "work": work}
        for name, fn in CHECKS.items():
            if a.only and name not in a.only:
                continue
            print(f"== {name}")
            profile = tempfile.mkdtemp(prefix="zzm-tool-")
            try:
                with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
                    z.call({"cmd": "resize", "width": 1280, "height": 900})
                    z.call({"cmd": "open", "rom": a.rom})
                    fn(z, shots, ctx)
                if name in PERSIST:
                    with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
                        z.call({"cmd": "resize", "width": 1280, "height": 900})
                        z.call({"cmd": "open", "rom": a.rom})
                        PERSIST[name](z, shots, ctx)
            finally:
                shutil.rmtree(profile, ignore_errors=True)
    print("失敗: " + str(len(failures)))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
