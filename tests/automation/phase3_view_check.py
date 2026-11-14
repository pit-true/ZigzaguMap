"""Phase3 の表示・ホバー・スタンプの機能（#228 ほか）を、素の ROM だけで確かめる（プロジェクトフォルダは写しだけを使う）。

  python tests/automation/phase3_view_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・--mute-audio・画面外。ROM には書き込まない。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - layoutShared: 場所の設定タブの「配置の共有」。素の BPRJ の 5.4 は 17 枚で共有していて、一覧のマップを押すと開く。
    共有していないマップ（3.0）では隠れる。かんたん表示とくわしく表示の両方。
  - hover: イベントのホバーの吹き出し（#226）。店の品物、もらえるアイテム、トレーナー、同じマスの 2 つ、0.4 秒の待ち、押すと消える。
  - warp: ワープの吹き出しの行き先の周辺画像（#240）と、ワープできないブロックの上のワープの印と警告。
  - history: マップの履歴（#237）。サイドボタン・view.back・Alt+Shift+BkSp で戻る・進む、マップ名で探して開く（Ctrl+F）、一覧の絞り込み。
  - ctrl: Ctrl を押している間の重ね描きの隠し（#238）、Ctrl＋右クリックでイベントの下のブロック、ステータスバーの補助の欄
    （ブロックの番号・移動許可・挙動、矩形選択の大きさ、隣のマップの帯の座標）。
  - stamps: スタンプ（#239）。2×3 の木を保存して主タイルセットが同じ街で貼る、副タイルセットを含むものは組が違うと出ない、
    名前の変更。続けて別の起動で開き直し・削除・素の ROM だけのときのメモリと出力（作業フォルダは一時フォルダ）。
  - usage: 移動許可の自動選択・使用回数・移動許可だけ違うマスの印（#235）。
  - warpMap: ワープの右クリックから行き先のマップを作る（#241）。見本の窓、バンク、新しいマップの戻りのワープ、1 回の取り消し、見本なしの 9×9。
  - clones: クローンの自動作成（#242）。1 番道路の人を南の端へ動かすとマサラタウンにクローン、北へ動かすと消える、取り消し、設定で切る。
  - hoverAsm（`--chronos` を渡したとき）: .s のラベルを付けたイベントの要約、ラベルが .s に無いときの知らせ。
    ラベルはメモリの上だけで変えて元に戻す（写しにも書かない）。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_png(data, path: pathlib.Path) -> None:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    path.write_bytes(base64.b64decode(png))


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, part: str | None = None) -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": part}) if part else z.call({"cmd": "screenshot"})
    save_png(data, shots / name)


def check_layout_shared(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    # 場所の設定タブの下の方まで見えるように、窓を縦に大きくする（画面外なので見た目は変わらない）。
    z.call({"cmd": "resize", "width": 1280, "height": 1500})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    z.call({"cmd": "click", "id": "header.mode.simple"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"かんたん表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    items = z.call({"cmd": "ui.list", "root": "easy.layoutShared.list"})
    buttons = [i for i in items if str(i.get("id", "")).startswith("easy.layoutShared.map:")]
    check(len(buttons) == 16, f"かんたん表示: 自分以外の 16 枚が押せる（{len(buttons)} 個）")
    shot(z, shots, "p3_layout_shared_simple.png", "easy.layoutShared.list")
    shot(z, shots, "p3_layout_shared_simple_window.png")
    if buttons:
        target = buttons[0]["id"].split(":", 1)[1]
        z.call({"cmd": "click", "id": buttons[0]["id"]})
        time.sleep(0.5)
        st = z.call({"cmd": "state"})
        opened = st.get("map") or {}
        check(f"{opened.get('bank')}.{opened.get('map')}" == target, f"一覧の {target} を押すと開く（開いたのは {opened.get('bank')}.{opened.get('map')}）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(not f["visible"], "かんたん表示: 共有していない 3.0 では隠れる")

    z.call({"cmd": "click", "id": "header.mode.classic"})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"くわしく表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    shot(z, shots, "p3_layout_shared_classic_window.png")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(not f["visible"], "くわしく表示: 共有していない 3.0 では隠れる")
    z.call({"cmd": "click", "id": "header.mode.simple"})


def hover_text(z: Zigzagu, kind: str, index: int) -> str:
    return z.call({"cmd": "event.hover", "kind": kind, "index": index})["text"]


def check_hover(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 5, "map": 3})
    z.call({"cmd": "tab", "name": "event"})
    t0 = time.time()
    text = hover_text(z, "person", 0)
    check("ショップ: モンスターボール、キズぐすり" in text, f"5.3 の店員: 品物が出る（{time.time() - t0:.2f} 秒）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    text = hover_text(z, "person", 0)
    check("アイテム: キズぐすり" in text and "「わたし フレンドリィ ショップの" in text, "1 番道路の店員: もらえるアイテムとセリフが出る")
    z.call({"cmd": "selectMap", "bank": 4, "map": 3})
    z.call({"cmd": "tab", "name": "event"})
    text = hover_text(z, "trap", 0)
    check("トレーナー 0x146" in text, "研究所のスクリプトタイル: ライバルのトレーナーの番号と戦闘前の文が出る")
    check(text.count("スクリプト ") >= 2, "同じマスのスクリプトタイル 2 つを区切って並べる")
    # マウスを止めると 0.4 秒後に出る（自動操作の hover は pointermove を送るだけ）
    z.call({"cmd": "event.hover.hide"})
    st = z.call({"cmd": "event.state"})
    p = st["events"]["persons"][3]
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "hover"})
    early = z.call({"cmd": "event.hover.state"})
    time.sleep(0.9)
    late = z.call({"cmd": "event.hover.state"})
    check(not early["visible"] and late["visible"] and "オーキド" in late["text"], "マウスを止めると 0.4 秒後に吹き出しが出る")
    shot(z, shots, "p3_event_hover.png")
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "down"})
    gone = z.call({"cmd": "event.hover.state"})
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "up"})
    check(not gone["visible"], "ボタンを押すと消える")
    z.call({"cmd": "tab", "name": "map"})
    try:
        hover_text(z, "person", 0)
        check(False, "イベントタブ以外では event.hover がエラーになる")
    except Exception:  # noqa: BLE001
        check(True, "イベントタブ以外では event.hover がエラーになる")


def check_warp(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    st = z.call({"cmd": "event.state"})
    check(st.get("warpWarnings") == [], f"マサラタウンのワープはどれもドアの上（警告 {st.get('warpWarnings')}）")
    r = z.call({"cmd": "event.hover", "kind": "warp", "index": 0})
    sec = r["sections"][0] if r["sections"] else {}
    check(sec.get("image") is True and "行き先: 4.0" in r["text"] and "まわり 7×7" in r["text"], "家のドア: 行き先のマップ名と周辺の画像が出る")
    check(sec.get("warn") is None, "ドアの上のワープには警告が無い")
    shot(z, shots, "p3_warp_hover.png")
    shot(z, shots, "p3_warp_hover_tip.png", "event.hover")
    # わざと草の上へ動かす（元に戻す）
    w = st["events"]["warps"][0]
    z.call({"cmd": "command", "name": "moveEvent", "args": {"bank": 3, "map": 0, "kind": "warp", "index": 0, "x": 10, "y": 15}})
    st = z.call({"cmd": "event.state"})
    check(st.get("warpWarnings") == [0], f"草の上へ動かすと警告の印が付く（{st.get('warpWarnings')}）")
    r = z.call({"cmd": "event.hover", "kind": "warp", "index": 0})
    check(r["sections"] and (r["sections"][0].get("warn") or "").startswith("このブロックではワープできません"), "吹き出しの先頭に「このブロックではワープできません」")
    shot(z, shots, "p3_warp_warning.png")
    z.call({"cmd": "event.hover.hide"})
    z.call({"cmd": "undo"})
    st = z.call({"cmd": "event.state"})
    check(st["events"]["warps"][0]["x"] == w["x"] and st.get("warpWarnings") == [], "元に戻すと印も消える")


def current(z: Zigzagu) -> str:
    m = z.call({"cmd": "history.state"})["current"] or {}
    return f"{m.get('bank')}.{m.get('map')}"


def check_history(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "tab", "name": "map"})
    for b, m in [(3, 0), (3, 1), (4, 1)]:
        z.call({"cmd": "selectMap", "bank": b, "map": m})
    for _ in range(2):
        z.call({"cmd": "mouse", "target": "map", "cell": [1, 1], "button": "back"})
        time.sleep(0.3)
    check(current(z) == "3.0", f"3 枚開いてサイドボタンで 2 回戻ると最初のマップ（{current(z)}）")
    z.call({"cmd": "mouse", "target": "map", "cell": [1, 1], "button": "forward"})
    time.sleep(0.3)
    check(current(z) == "3.1", f"進むボタンで 1 つ進む（{current(z)}）")
    z.call({"cmd": "action", "id": "view.back"})
    time.sleep(0.3)
    st = z.call({"cmd": "history.state"})
    check(current(z) == "3.0" and len(st["forward"]) == 2, f"view.back で戻り、進むが 2 つ（{st['forward']}）")
    z.call({"cmd": "key", "key": "Backspace", "alt": True, "shift": True})
    time.sleep(0.3)
    check(current(z) == "3.1", f"Alt+Shift+BkSp で進む（{current(z)}）")
    z.call({"cmd": "selectMap", "bank": 5, "map": 0})
    st = z.call({"cmd": "history.state"})
    check(st["forward"] == [], "戻ってから別のマップを開くと進むは消える")
    # マップ名で探して開く
    r = z.call({"cmd": "mapFind", "query": "ときわ ぽけせん"})
    texts = [c["text"] for c in r["candidates"]]
    check(len(texts) > 0 and texts[0].startswith("5.4"), f"「ときわ ぽけせん」で 5.4 が先頭（{texts[:3]}）")
    z.call({"cmd": "menu.run", "id": "map.find"})
    dlg = [d for d in z.call({"cmd": "dialogs"})["dialogs"] if d.get("title") == "マップ名で探して開く"]
    check(len(dlg) == 1, "Ctrl+F（ツール > マップ名で探して開く）で窓が出る")
    z.call({"cmd": "setField", "id": "mapFind.input", "value": "ニビ"})
    shot(z, shots, "p3_map_find.png")
    z.call({"cmd": "dialog", "press": "ok"})
    time.sleep(0.5)
    check(current(z).startswith("3.2"), f"「ニビ」で Enter（OK）すると先頭のニビシティ 3.2 を開く（{current(z)}）")
    # マップ一覧の絞り込み
    z.call({"cmd": "tree.filter", "text": "ポケセン"})
    items = z.call({"cmd": "tree.list", "visibleOnly": True})
    maps = [i for i in items if i.get("mapId")]
    check(len(maps) > 5 and all("ポケセン" in i["text"] for i in maps), f"一覧を「ポケセン」で絞り込むと合う項目だけ（{len(maps)} 件）")
    shot(z, shots, "p3_tree_filter.png")
    z.call({"cmd": "tree.filter", "text": ""})
    after = [i for i in z.call({"cmd": "tree.list", "visibleOnly": True}) if i.get("mapId")]
    check(len(after) < len(maps) + 50 and len(z.call({"cmd": "tree.list"})) > 300, "絞り込みを消すと元の開き方に戻る")


def png(z: Zigzagu, target: str) -> str:
    r = z.call({"cmd": "canvasPng", "target": target})
    return r if isinstance(r, str) else (r.get("png") or r.get("data"))


def info(z: Zigzagu) -> str:
    return z.call({"cmd": "getField", "id": "status.info"})["value"]


def check_ctrl(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    for tab in ["movement", "event"]:
        z.call({"cmd": "tab", "name": tab})
        before = png(z, tab)
        z.call({"cmd": "key", "key": "Control", "ctrl": True, "type": "down"})
        held = png(z, tab)
        if shots:
            save_png(z.call({"cmd": "screenshot"}), shots / f"p3_ctrl_hide_{tab}.png")
        z.call({"cmd": "key", "key": "Control", "type": "up"})
        after = png(z, tab)
        check(before != held and before == after, f"{tab}: Ctrl を押している間だけ重ね描きが消える")
    # イベントタブ: Ctrl＋右クリックでイベントの下のブロックを拾う
    st = z.call({"cmd": "event.state"})
    sign = st["events"]["signs"][0]
    cells = z.call({"cmd": "cells"})
    z.call({"cmd": "mouse", "target": "event", "cell": [sign["x"], sign["y"]], "action": "rightClick", "ctrl": True})
    menu = z.call({"cmd": "contextMenu.state"})
    sel = z.call({"cmd": "selection"})
    want = cells["cells"][sign["y"] * cells["width"] + sign["x"]] & 0x3FF
    got = (sel.get("block") or {}).get("blocks")
    check(menu is None and got == [want], f"イベントタブ: Ctrl＋右クリックはメニューを出さず、下のブロックを拾う（{got} / {want}）")
    z.call({"cmd": "mouse", "target": "event", "cell": [sign["x"], sign["y"]], "action": "hover"})
    z.call({"cmd": "mouse", "target": "event", "cell": [sign["x"] + 1, sign["y"]], "action": "hover"})
    # マップタブ: ブロックの情報（Q8）と矩形選択の大きさ
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "mouse", "target": "map", "cell": [5, 5], "action": "hover"})
    text = info(z)
    check("ブロック" in text and "移動許可" in text and "挙動" in text, f"マップタブ: カーソルのブロックの番号・移動許可・挙動（{text}）")
    z.call({"cmd": "mouse", "target": "map", "cell": [2, 3], "action": "down", "button": "right", "ctrl": True})
    z.call({"cmd": "mouse", "target": "map", "cell": [5, 4], "action": "move", "button": "right", "ctrl": True})
    text = info(z)
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_rect_size.png")
    z.call({"cmd": "mouse", "target": "map", "cell": [5, 4], "action": "up", "button": "right", "ctrl": True})
    check("4×2" in text, f"Ctrl＋右ドラッグの間は矩形の大きさ（{text}）")
    sel = z.call({"cmd": "selection"})
    # 隣のマップの帯の上（マサラタウンの北は 1 番道路 3.19）
    z.call({"cmd": "neighbors.state", "wait": True})
    z.call({"cmd": "mouse", "target": "map", "cell": [8, -2], "action": "hover"})
    text = info(z)
    check(text.startswith("3.19") and "Y: " in text, f"隣のマップの帯の上では隣のマップ名と座標（{text}）")
    z.call({"cmd": "selectBlock", "block": 1})


def check_stamps(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """スタンプ（#239）。プロジェクトフォルダは一時フォルダ（空）を使う。"""
    work = pathlib.Path(ctx["work"])
    folder = work / "stamp-project"
    folder.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(folder)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    # 左の端の木（2×3）をマップから拾う
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [0, 4], "to": [1, 6]})
    sel = z.call({"cmd": "selection"})["block"]
    check(sel["width"] == 2 and sel["height"] == 3 and "movements" in sel, f"Ctrl＋右ドラッグで 2×3 を拾う（{sel['width']}×{sel['height']}）")
    r = z.call({"cmd": "stamps.save", "name": "大きな木"})
    tree = next((s for s in r["all"] if s["name"] == "大きな木"), None)
    check(r["ok"] and tree and (folder / "maps" / "stamps" / "大きな木.json").exists(), "「大きな木」を保存すると maps/stamps/大きな木.json に書く")
    check((folder / "maps" / "project.json").exists(), "スタンプを書く前に maps/project.json を作る")
    check(tree is not None and not tree["secondaryUsed"], "木は主タイルセットのブロックだけ")
    # 副タイルセットのブロックを含む 2×2 を探して保存する
    cells = z.call({"cmd": "cells"})
    w = cells["width"]
    spot = None
    for y in range(cells["height"] - 1):
        for x in range(w - 1):
            if all((cells["cells"][(y + dy) * w + x + dx] & 0x3FF) >= 0x280 for dx in (0, 1) for dy in (0, 1)):
                spot = (x, y)
                break
        if spot:
            break
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": list(spot), "to": [spot[0] + 1, spot[1] + 1]})
    r = z.call({"cmd": "stamps.save", "name": "家の一部"})
    house = next((s for s in r["all"] if s["name"] == "家の一部"), None)
    check(house is not None and house["secondaryUsed"], f"副タイルセットのブロックを含むスタンプ（{spot}）")
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_stamp_panel.png")
        save_png(z.call({"cmd": "ui.shot", "id": "stamp.panel"}), shots / "p3_stamp_panel_part.png")
    # 主タイルセットが同じ別の街（トキワシティ 3.1）
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    lst = z.call({"cmd": "stamps.list"})
    check("大きな木" in lst["shown"] and "家の一部" not in lst["shown"], f"トキワシティでは木だけが一覧に出る（{lst['shown']}）")
    before = z.call({"cmd": "cells"})["cells"]
    z.call({"cmd": "stamps.select", "name": "大きな木"})
    z.call({"cmd": "mouse", "target": "map", "cell": [10, 10]})
    after = z.call({"cmd": "cells"})["cells"]
    tw = z.call({"cmd": "cells"})["width"]
    pasted = [after[(10 + dy) * tw + 10 + dx] for dy in range(3) for dx in range(2)]
    want = [sel["blocks"][i] | (sel["movements"][i] << 10) for i in range(6)]
    check(pasted == want and before != after, "選んで左クリックすると木（ブロックと移動許可）を貼れる")
    z.call({"cmd": "undo"})
    # 名前の変更と削除
    r = z.call({"cmd": "stamps.rename", "name": "家の一部", "to": "家"})
    check(r["ok"] and (folder / "maps" / "stamps" / "家.json").exists() and not (folder / "maps" / "stamps" / "家の一部.json").exists(), "名前を変えるとファイル名も変わる")
    ctx["stampFolder"] = str(folder)


def check_stamps_reopen(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    folder = ctx.get("stampFolder")
    if not folder:
        return
    z.call({"cmd": "open", "rom": ctx["rom"], "project": folder})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    names = [s["name"] for s in z.call({"cmd": "stamps.list"})["all"]]
    check(names == ["家", "大きな木"] or sorted(names) == sorted(["家", "大きな木"]), f"開き直しても一覧が残る（{names}）")
    r = z.call({"cmd": "stamps.remove", "name": "家"})
    check(r["ok"] and not (pathlib.Path(folder) / "maps" / "stamps" / "家.json").exists(), "削除するとファイルも消える")
    # 素の ROM だけで開いたときはメモリに持ち、出力先を選ぶと書く
    z.call({"cmd": "open", "rom": ctx["rom"]})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [0, 4], "to": [1, 6]})
    r = z.call({"cmd": "stamps.save", "name": "メモリの木"})
    check(r["memoryOnly"] and r["pending"] == 1, "素の ROM だけではメモリに持つ")
    out = pathlib.Path(ctx["work"]) / "stamp-export"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    check((out / "maps" / "stamps" / "メモリの木.json").exists(), "出力先を選んで出力するとスタンプも書く")


def check_usage(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """移動許可の自動選択・使用回数・移動許可だけ違うマスの印（#235）。"""
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    cells = z.call({"cmd": "cells"})
    tree = cells["cells"][5 * cells["width"] + 0] & 0x3FF
    z.call({"cmd": "blockUsage", "block": tree})
    z.call({"cmd": "selectBlock", "block": 0})
    t0 = time.time()
    z.call({"cmd": "selectBlock", "block": tree})
    u = z.call({"cmd": "blockUsage"})
    sel = z.call({"cmd": "selection"})
    check(u["mostMovement"] == 1 and sel.get("movement") == 1, f"木のブロック {tree:#x} を選ぶと移動許可が「壁」（1）になる（{sel.get('movement')}）")
    shown = z.call({"cmd": "getField", "id": "map.blockUsage"})["value"]
    check(f"使用回数: {u['count']}" in shown and f"このマップ {u['here']}" in shown, f"使用回数の表示（{shown}）")
    # わざと 1 マスの移動許可を変えると、そのマスに印が付く
    z.call({"cmd": "command", "name": "paintMovement", "args": {"bank": 3, "map": 0, "cells": [{"x": 0, "y": 5, "movement": 0x0C}]}})
    u = z.call({"cmd": "blockUsage"})
    check({"x": 0, "y": 5, "movement": 0x0C} in u["mismatches"] and u["marks"]["map"] >= 1, f"移動許可だけ違うマスに印（{len(u['mismatches'])} 個、印 {u['marks']['map']}）")
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_usage_marks.png")
    z.call({"cmd": "action", "id": "view.usageMarks"})
    u2 = z.call({"cmd": "blockUsage"})
    check(u2["marks"]["map"] == 0, "表示 > 移動許可の強調 を切ると印が消える")
    z.call({"cmd": "action", "id": "view.usageMarks"})
    z.call({"cmd": "undo"})
    # 移動エリアタブ: 選んだ移動許可のマス
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "selectMovement", "value": 1})
    u = z.call({"cmd": "blockUsage"})
    check(u["marks"]["movement"] > 0, f"移動エリアタブで選んだ移動許可のマスを強調（{u['marks']['movement']} マス）")
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_usage_movement.png")
    # 自動で選ぶを切る
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "setField", "id": "map.autoMovement", "value": False})
    before = z.call({"cmd": "selection"}).get("movement")
    z.call({"cmd": "selectBlock", "block": 0x001})
    after = z.call({"cmd": "selection"}).get("movement")
    check(before == after, "「移動許可を自動で選ぶ」を切ると移動許可は変わらない")
    z.call({"cmd": "setField", "id": "map.autoMovement", "value": True})
    z.call({"cmd": "selectMovement", "value": 0x0C})
    # マップから拾った複数選択（移動許可を持つ）には当てない
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [0, 4], "to": [0, 4]})
    after2 = z.call({"cmd": "selection"}).get("movement")
    check(after2 == 0x0C, f"移動許可を持つ選択（マップから拾ったもの）では移動許可を変えない（{after2}）")


def wait_dialog(z: Zigzagu, title: str, timeout: float = 15) -> dict | None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        for d in z.call({"cmd": "dialogs"})["dialogs"]:
            if d.get("title") == title:
                return d
        time.sleep(0.2)
    return None


def check_warp_map(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """ワープの右クリックから行き先のマップを作る（#241）。素の ROM のメモリの上だけで作って、元に戻す。"""
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    samples = z.call({"cmd": "warp.samples", "index": 0})["samples"]
    check(len(samples) >= 1, f"マサラタウンの家のドアの見本が見つかる（{[(s['map']['bank'], s['map']['map']) for s in samples]}）")
    st = z.call({"cmd": "event.state"})
    w = st["events"]["warps"][0]
    z.call({"cmd": "mouse", "target": "event", "cell": [w["x"], w["y"]], "action": "rightClick"})
    menu = z.call({"cmd": "contextMenu.state"}) or {}
    ids = [i["id"] for i in menu.get("items", [])]
    check("createWarpMap" in ids, f"ワープの右クリックに「行き先のマップを作る」（{ids}）")
    z.call({"cmd": "contextMenu.press", "id": "createWarpMap"})
    d = wait_dialog(z, "行き先のマップを作る")
    check(d is not None, "見本を選ぶ窓が出る")
    time.sleep(0.5)
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_warp_map_dialog.png")
    z.call({"cmd": "dialog", "title": "行き先のマップを作る", "press": "ok"})
    b = wait_dialog(z, "新しいマップのバンク")
    check(b is not None, "バンクを聞く")
    counts_before = z.call({"cmd": "state"})
    z.call({"cmd": "dialog", "title": "新しいマップのバンク", "press": "ok"})
    time.sleep(1.0)
    st = z.call({"cmd": "state"})
    m = st.get("map") or {}
    check(m.get("bank") == 3 and m.get("map") not in (0, None), f"新しいマップを開く（{m.get('bank')}.{m.get('map')}）")
    ev = z.call({"cmd": "event.state"})
    back = ev["events"]["warps"][0] if ev["events"]["warps"] else {}
    check(back.get("bank") == 3 and back.get("map") == 0 and back.get("warpId") == 0, f"新しいマップのワープ 0 は元のワープへ戻る（{back}）")
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_warp_map_created.png")
    z.call({"cmd": "undo"})
    time.sleep(0.5)
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    w2 = z.call({"cmd": "event.state"})["events"]["warps"][0]
    check(w2 == w, "1 回の取り消しで新しいマップも元のワープも戻る")
    # 見本を使わない（9×9）
    r = z.call({"cmd": "warp.createMap", "index": 0, "sample": None, "bank": 3})
    cells = z.call({"cmd": "cells"})
    check(r["target"] is not None and cells["width"] == 9 and cells["height"] == 9, f"見本を使わないと 9×9（{cells['width']}×{cells['height']}）")
    z.call({"cmd": "undo"})


def clones_in(z: Zigzagu, bank: int, map_: int) -> list:
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    z.call({"cmd": "tab", "name": "event"})
    return z.call({"cmd": "event.state"})["clones"]


def check_clones(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """クローンの自動作成（#242）。1 番道路（3.19）の人を南の端へ動かすと、マサラタウン（3.0）にクローンができる。"""
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    before = len(clones_in(z, 3, 0))
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    st = z.call({"cmd": "event.state"})
    cells = z.call({"cmd": "cells"})
    p = st["events"]["persons"][0]
    south = [10, cells["height"] - 2]
    z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": [p["x"], p["y"]], "to": south})
    time.sleep(1.0)
    status = z.call({"cmd": "getField", "id": "status.info"})["value"]
    clones = clones_in(z, 3, 0)
    check(len(clones) == before + 1 and clones[-1]["target"] == {"bank": 3, "map": 19, "localId": p["localId"]}, f"1 番道路の南の端に人を動かすとマサラタウンにクローン（{clones}）")
    check("クローンを作りました" in status, f"ステータスバーで知らせる（{status}）")
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / "p3_clone_created.png")
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": south, "to": [10, cells["height"] - 12]})
    time.sleep(1.0)
    check(len(clones_in(z, 3, 0)) == before, "北へ 8 マスより外へ動かすとクローンが消える")
    z.call({"cmd": "undo"})
    check(len(clones_in(z, 3, 0)) == before + 1, "1 回の取り消しで人もクローンも戻る")
    z.call({"cmd": "undo"})
    check(len(clones_in(z, 3, 0)) == before, "もう 1 回の取り消しで作る前に戻る")
    # 元の人を消すとクローンも消える（イベントの削除。確かめずに消す）
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": [p["x"], p["y"]], "to": south})
    time.sleep(1.0)
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "event.delete", "kind": "person", "index": 0, "confirm": False})
    check(len(clones_in(z, 3, 0)) == before, "元の人を消すとクローンも消える")
    z.call({"cmd": "undo"})
    check(len(clones_in(z, 3, 0)) == before + 1, "削除を取り消すとクローンも戻る")
    z.call({"cmd": "undo"})
    # 設定で切れる
    z.call({"cmd": "action", "id": "opt.autoClones"})
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": [p["x"], p["y"]], "to": south})
    time.sleep(1.0)
    check(len(clones_in(z, 3, 0)) == before, "設定を切るとクローンを作らない")
    z.call({"cmd": "undo"})
    z.call({"cmd": "action", "id": "opt.autoClones"})


CHECKS_RESTART = {"stampsReopen": check_stamps_reopen}


def check_hover_asm(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """Chronos の写し（読むだけ）で、.s のラベルを付けたイベントの要約。ラベルはメモリの上だけで変え、出力しない。"""
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "person", "index": 0, "label": "EventScript_TestFixture_Famicom", "kind": "npc"})
    z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "sign", "index": 1, "label": "EventScript_Nope"})
    t0 = time.time()
    text = hover_text(z, "person", 0)
    first = time.time() - t0
    check("ラベル: EventScript_TestFixture_Famicom" in text and "トレーナー 0x19E" in text and "ポケモン: フシギダネ Lv.30" in text,
          f".s のラベル: セリフ・ポケモン・トレーナーが出る（初回 {first:.2f} 秒、索引を作る分を含む）")
    t0 = time.time()
    hover_text(z, "person", 0)
    check(time.time() - t0 < 0.5, f"2 回目は覚えた答え（{time.time() - t0:.3f} 秒）")
    text = hover_text(z, "sign", 1)
    check("EventScript_Nope が .s に見つかりません" in text and "ROM のスクリプトを出します" in text, "ラベルが .s に無ければ知らせて ROM のスクリプトを出す")
    shot(z, shots, "p3_event_hover_asm.png")
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})


CHECKS = {
    "layoutShared": check_layout_shared,
    "hover": check_hover,
    "warp": check_warp,
    "history": check_history,
    "ctrl": check_ctrl,
    "stamps": check_stamps,
    "usage": check_usage,
    "warpMap": check_warp_map,
    "clones": check_clones,
}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--chronos", help="Chronos のフォルダの写し（読むだけ。.s のラベルの要約を確かめる）")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    names = [n for n in (args.only or list(CHECKS)) if n in CHECKS]
    work = tempfile.TemporaryDirectory(prefix="zzm-p3work-", ignore_cleanup_errors=True)
    ctx: dict = {"rom": args.rom, "work": work.name}
    with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        for name in names:
            print(f"== {name}")
            try:
                CHECKS[name](z, shots, ctx)
            except Exception as e:  # noqa: BLE001
                check(False, f"{name}: 例外 {e}")
    if "stampFolder" in ctx:
        # 開き直し（別の起動）
        with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            for name, fn in CHECKS_RESTART.items():
                print(f"== {name}")
                try:
                    fn(z, shots, ctx)
                except Exception as e:  # noqa: BLE001
                    check(False, f"{name}: 例外 {e}")
    if args.chronos and (not args.only or "hoverAsm" in args.only):
        root = pathlib.Path(args.chronos)
        with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": str(root / "base" / "BPRJ0.gba"), "project": str(root / "cfru")})
            print("== hoverAsm")
            try:
                check_hover_asm(z, shots, {})
            except Exception as e:  # noqa: BLE001
                check(False, f"hoverAsm: 例外 {e}")
    work.cleanup()
    print(f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
