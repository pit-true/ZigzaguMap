"""タウンマップの小窓で今のマップの位置を自分で紐づける機能（#386）を確かめる。

  python tests/automation/town_link_check.py --rom <素の BPRJ の写し> [--project <プロジェクトフォルダの写し>] [--exe <zigzagumap.exe>]
      [--shots <フォルダ>] [--keep <フォルダ>]

- 起動は --automation・--profile（一時フォルダ）・画面外。出力はしない。
- ROM だけ: 右クリック・右ドラッグのメニューから地名とマップを紐づけ、優先順（マップ → 地名 → ROM のデータ → 無し）、
  見分け（下の欄の文）、外す、案内の文、地名を紐づけた範囲を押したときの絞り込みを見る。保存先は個人設定の `townLinks` で、
  同じ --profile で起動し直しても残ること、ROM が 1 バイトも変わらないことを見る。
- プロジェクト: `--project` が無ければ一時フォルダに小さなプロジェクト（`zigzagumap.json` に `script` の節と知らない項目、
  `maps\\regionmap.json`）を作る。紐づけが `zigzagumap.json` の `townMap` に入り、ほかの節と知らない項目が残り、
  `zigzagumap.json` 以外のファイル（`maps\\regionmap.json` など）と ROM が 1 バイトも変わらないことを見る。
- `--shots` があれば ROM のデータの枠・自分で紐づけた枠・案内・右クリックのメニューを撮る（`fb4_town_*.png`。ライトとダーク）。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import pathlib
import shutil
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


def px(x: int, y: int) -> list[int]:
    """タウンマップのマスの中央（小窓の絵の左上からの画素）。"""
    return [32 + x * 8 + 4, 32 + y * 8 + 4]


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_digest(root: pathlib.Path, skip: set[str]) -> dict[str, str]:
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob("*")) if p.is_file() and p.name not in skip}


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, part: str | None = "town") -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": part}) if part else z.call({"cmd": "screenshot"})
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    (shots / name).write_bytes(base64.b64decode(png))


def town(z: Zigzagu) -> dict:
    return z.call({"cmd": "town.state", "wait": True})


def wait_links(z: Zigzagu, cond, what: str) -> dict:
    """メニューから押した保存は少しあとに終わるので、`links` が変わるまで待つ。"""
    st = town(z)
    for _ in range(100):
        if cond(st):
            return st
        time.sleep(0.05)
        st = town(z)
    check(False, f"{what}（待っても変わらない: {st.get('links')}）")
    return st


def section_of(st: dict, region: int) -> dict | None:
    return next((s for s in st["links"]["sections"] if s["region"] == region), None)


def map_of(st: dict, bank: int, map_: int) -> dict | None:
    return next((m for m in st["links"]["maps"] if m["bank"] == bank and m["map"] == map_), None)


def menu_ids(z: Zigzagu) -> list[str]:
    menu = z.call({"cmd": "contextMenu.state"})
    return [i["id"] for i in menu["items"]] if menu else []


def other_map_in_region(z: Zigzagu, region: int, not_this: tuple[int, int]) -> tuple[int, int] | None:
    z.call({"cmd": "tree.filter", "text": f"場所:{region:02X}"})
    items = [i["mapId"] for i in z.call({"cmd": "tree.list"}) if i.get("mapId")]
    z.call({"cmd": "tree.filter", "text": ""})
    for m in items:
        if (m["bank"], m["map"]) != not_this:
            return m["bank"], m["map"]
    return None


def unplaced_map(z: Zigzagu) -> tuple[int, int] | None:
    """ROM のデータに位置の無い地名のマップ（地名ごとに 1 枚ずつ選んで、枠が無いものを探す）。"""
    seen: set[int] = set()
    for item in z.call({"cmd": "tree.list"}):
        m = item.get("mapId")
        if not m:
            continue
        info = z.call({"cmd": "catalog.get", **m})
        region = info["region"] if info else None
        if region is None or region in seen:
            continue
        seen.add(region)
        z.call({"cmd": "selectMap", **m})
        st = town(z)
        if st["source"] is None:
            return m["bank"], m["map"]
    return None


def set_theme(z: Zigzagu, theme: str) -> None:
    z.call({"cmd": "setting", "key": "theme", "value": theme})
    time.sleep(0.2)


def check_links(z: Zigzagu, shots: pathlib.Path | None, place: str, tag: str) -> None:
    """紐づけの操作を一通り（ROM だけとプロジェクトで同じ）。終わりに 3.0 と地名 0x58 の紐づけを残す。"""
    z.call({"cmd": "tree.filter", "text": ""})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    if not z.call({"cmd": "town.state"})["open"]:
        z.call({"cmd": "menu.run", "id": "view.townMap"})
    st = town(z)
    check(st["open"] and st["loaded"] and st["store"] == place, f"[{tag}] 小窓を出す、保存先 {st['store']}（{place} のはず）")
    check(st["source"] == "rom" and st["frame"] is not None and st["links"] == {"sections": [], "maps": []},
          f"[{tag}] 初めは ROM のデータの枠（{st['frame']}）")
    check("（ROM のデータ）" in (st["label"] or ""), f"[{tag}] 下の欄に（ROM のデータ）: {st['label']!r}")
    rom_frame = st["frame"]
    if tag == "rom":
        for theme in ("light", "dark"):
            set_theme(z, theme)
            shot(z, shots, f"fb4_town_rom_{theme}.png")
        set_theme(z, "light")

    base = z.call({"cmd": "state"})
    # 右クリック（1 マス）→ 今の地名をここに紐づける
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "rightClick", "px": px(10, 5)})
    ids = menu_ids(z)
    check(ids == ["town.linkSection", "town.linkMap"], f"[{tag}] 右クリックのメニュー（紐づけが無いので外す項目は無い）: {ids}")
    labels = [i["label"] for i in z.call({"cmd": "contextMenu.state"})["items"]]
    check(labels[0].startswith("今の地名（58") and labels[0].endswith("）をここに紐づける") and labels[1] == "今のマップだけをここに紐づける",
          f"[{tag}] メニューの文: {labels}")
    st = town(z)
    check(st["selection"] == {"x": 10, "y": 5, "width": 1, "height": 1}, f"[{tag}] メニューを出している間は選んだマスを点線で囲む（{st['selection']}）")
    if tag == "rom":
        shot(z, shots, "fb4_town_menu_light.png", None)
    z.call({"cmd": "contextMenu.press", "id": "town.linkSection"})
    st = wait_links(z, lambda s: section_of(s, 0x58) is not None, f"[{tag}] 地名 58 の紐づけが入る")
    check(section_of(st, 0x58) == {"region": 0x58, "page": 0, "x": 10, "y": 5, "width": 1, "height": 1}, f"[{tag}] 地名の紐づけ: {st['links']}")
    check(st["source"] == "section" and st["frame"] == {"x": 10, "y": 5, "width": 1, "height": 1}, f"[{tag}] 枠は紐づけた位置（{st['source']}、{st['frame']}）")
    check("（自分で紐づけ）" in (st["label"] or ""), f"[{tag}] 下の欄に（自分で紐づけ）: {st['label']!r}")
    check(st["selection"] is None, f"[{tag}] 押したら点線を消す")
    after = z.call({"cmd": "state"})
    check((after["history"], after["canUndo"], after["dirty"]) == (base["history"], base["canUndo"], base["dirty"]),
          f"[{tag}] 取り消しの履歴と未出力の印は変わらない（{base['history']}・{base['dirty']} → {after['history']}・{after['dirty']}）")

    # 同じ地名の別のマップにも出る（地名単位）
    other = other_map_in_region(z, 0x58, (3, 0))
    if other:
        z.call({"cmd": "selectMap", "bank": other[0], "map": other[1]})
        st = town(z)
        check(st["source"] == "section" and st["frame"] == {"x": 10, "y": 5, "width": 1, "height": 1}, f"[{tag}] 同じ地名の {other} にも地名の紐づけ（{st['source']}）")
    else:
        check(False, f"[{tag}] 地名 58 のほかのマップが見つからない")
    # 別の地名のマップは ROM のデータのまま
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    st = town(z)
    check(st["source"] == "rom" and st["region"] != 0x58, f"[{tag}] 別の地名（{st['region']}）は ROM のデータのまま")

    # 右ドラッグ（範囲）→ 今のマップだけをここに紐づける
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "drag", "button": "right", "px": px(2, 2), "toPx": px(4, 3)})
    ids = menu_ids(z)
    check(ids == ["town.linkSection", "town.linkMap", "town.unlinkSection"], f"[{tag}] 右ドラッグのメニュー（地名の紐づけを外す項目が出る）: {ids}")
    check(town(z)["selection"] == {"x": 2, "y": 2, "width": 3, "height": 2}, f"[{tag}] 右ドラッグで範囲を選ぶ")
    z.call({"cmd": "contextMenu.press", "id": "town.linkMap"})
    st = wait_links(z, lambda s: map_of(s, 3, 0) is not None, f"[{tag}] マップ 3.0 の紐づけが入る")
    check(map_of(st, 3, 0) == {"bank": 3, "map": 0, "page": 0, "x": 2, "y": 2, "width": 3, "height": 2}, f"[{tag}] マップの紐づけ: {st['links']['maps']}")
    check(st["source"] == "map" and st["frame"] == {"x": 2, "y": 2, "width": 3, "height": 2}, f"[{tag}] マップの紐づけが地名の紐づけより先（{st['source']}）")
    check("（自分で紐づけ・このマップだけ）" in (st["label"] or ""), f"[{tag}] 下の欄: {st['label']!r}")
    if tag == "rom":
        for theme in ("light", "dark"):
            set_theme(z, theme)
            shot(z, shots, f"fb4_town_linked_{theme}.png")
        set_theme(z, "light")
    if other:
        z.call({"cmd": "selectMap", "bank": other[0], "map": other[1]})
        check(town(z)["source"] == "section", f"[{tag}] 同じ地名のほかのマップは地名の紐づけのまま")
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})

    # 地名を紐づけたマスを押す・乗せると、紐づけた地名
    picked = z.call({"cmd": "town.pick", "x": 10, "y": 5})
    check(picked["region"] == 0x58 and picked["filter"] == "場所:58", f"[{tag}] 紐づけたマスを押すと場所:58 で絞る（{picked}）")
    z.call({"cmd": "tree.filter", "text": ""})
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "hover", "px": px(10, 5)})
    st = z.call({"cmd": "town.state"})
    check(st["hovered"] == 0x58, f"[{tag}] 乗せると紐づけた地名（{st['hovered']}）")
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "hover", "px": [2, 2]})

    # 面も記録する（今の面で紐づけ、紐づけのある面へ切り替える）
    z.call({"cmd": "setField", "id": "town.page", "value": 2})
    st = z.call({"cmd": "town.state"})
    check(st["page"] == 2 and st["frame"] is None, f"[{tag}] 面を変えると枠は出ない（面 {st['page']}）")
    st = z.call({"cmd": "town.link", "scope": "map", "x": 7, "y": 8})
    check(map_of(st, 3, 0)["page"] == 2 and st["frame"] == {"x": 7, "y": 8, "width": 1, "height": 1}, f"[{tag}] town.link は今の面（2）に紐づける")
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    st = town(z)
    check(st["page"] == 2 and st["source"] == "map", f"[{tag}] 紐づけのある面へ自動で切り替える（面 {st['page']}）")
    st = z.call({"cmd": "town.link", "scope": "map", "x": 2, "y": 2, "width": 3, "height": 2, "page": 0})
    check(st["page"] == 0 and st["frame"] == {"x": 2, "y": 2, "width": 3, "height": 2}, f"[{tag}] page を指定して紐づけ直す")
    try:
        z.call({"cmd": "town.link", "scope": "map", "x": 21, "y": 0, "width": 2})
        check(False, f"[{tag}] 表の外は断る")
    except Exception as e:  # noqa: BLE001
        check("外" in str(e), f"[{tag}] 表の外は断る（{e}）")

    # 外す（メニューから）→ 地名の紐づけに戻る
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "rightClick", "px": px(0, 0)})
    ids = menu_ids(z)
    check(ids == ["town.linkSection", "town.linkMap", "town.unlinkMap", "town.unlinkSection"], f"[{tag}] 両方あれば外す項目が 2 つ: {ids}")
    z.call({"cmd": "contextMenu.press", "id": "town.unlinkMap"})
    st = wait_links(z, lambda s: map_of(s, 3, 0) is None, f"[{tag}] マップの紐づけを外す")
    check(st["source"] == "section", f"[{tag}] 外すと地名の紐づけに戻る（{st['source']}）")
    st = z.call({"cmd": "town.unlink", "scope": "section"})
    check(st["removed"] and st["source"] == "rom" and st["frame"] == rom_frame, f"[{tag}] 地名の紐づけも外すと ROM のデータに戻る（{st['frame']}）")
    st = z.call({"cmd": "town.unlink", "scope": "section"})
    check(st["removed"] is False, f"[{tag}] 無い紐づけを外すと removed: false")

    # ROM のデータにも紐づけにも無いときの案内
    if tag == "rom":
        m = unplaced_map(z)
        if m:
            st = town(z)
            check(st["source"] is None and st["frame"] is None and "紐づけがありません" in (st["label"] or "")
                  and "小窓を右クリックして「ここに紐づける」を選んでください" in st["label"], f"[{tag}] {m} は案内を出す: {st['label']!r}")
            for theme in ("light", "dark"):
                set_theme(z, theme)
                shot(z, shots, f"fb4_town_none_{theme}.png")
            set_theme(z, "light")
            st = z.call({"cmd": "town.link", "scope": "map", "x": 12, "y": 7})
            check(st["source"] == "map" and st["frame"] == {"x": 12, "y": 7, "width": 1, "height": 1}, f"[{tag}] 案内のマップも紐づけられる")
            z.call({"cmd": "town.unlink", "scope": "map"})
        else:
            print("     （ROM のデータに位置の無い地名のマップが無いので、案内の文は見ない）")

    # 終わりに残す（再起動・ファイルの中身を見る）
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "town.link", "scope": "section", "x": 10, "y": 5})
    z.call({"cmd": "town.link", "scope": "map", "x": 2, "y": 2, "width": 3, "height": 2})


def rom_only(args, shots: pathlib.Path | None, rom: pathlib.Path) -> None:
    print("== ROM だけ")
    before = digest(rom)
    with tempfile.TemporaryDirectory(prefix="zzm-town-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(args.exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": str(rom)}, timeout=120)
            check_links(z, shots, "personal", "rom")
        saved = json.loads((pathlib.Path(profile) / "settings.json").read_text(encoding="utf-8"))
        links = saved.get("townLinks", {})
        key = next((k for k in links if k.replace("/", "\\") == str(rom).lower().replace("/", "\\")), None)
        check(key is not None, f"個人設定の townLinks に ROM の小文字のパスの鍵（{list(links)}）")
        if key:
            check(links[key].get("sections", {}).get("0x58") == {"page": 0, "x": 10, "y": 5, "width": 1, "height": 1}
                  and links[key].get("maps", {}).get("3.0") == {"page": 0, "x": 2, "y": 2, "width": 3, "height": 2}, f"個人設定の中身: {links[key]}")
        # 起動し直しても残る
        with Zigzagu(args.exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": str(rom)}, timeout=120)
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            if not z.call({"cmd": "town.state"})["open"]:
                z.call({"cmd": "menu.run", "id": "view.townMap"})
            st = town(z)
            check(st["source"] == "map" and section_of(st, 0x58) is not None, f"起動し直しても紐づけが残る（{st['source']}、{st['links']}）")
    check(digest(rom) == before, "ROM は 1 バイトも変わらない")


def make_project(root: pathlib.Path) -> None:
    (root / "maps").mkdir(parents=True, exist_ok=True)
    rows = [" ".join(["C5"] * 22)] * 15
    (root / "maps" / "regionmap.json").write_text(
        json.dumps({"Format": 1, "Layouts": [{"Page": "sevii67", "Layer": "dungeon", "Rows": rows}]}, indent=2) + "\n", encoding="utf-8")
    (root / "zigzagumap.json").write_text(
        json.dumps({"script": {"dialect": "nd", "myOwn": 1}, "custom": {"keep": True}}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def project(args, rom: pathlib.Path, work: pathlib.Path) -> None:
    print("== プロジェクト")
    proj = pathlib.Path(args.project) if args.project else work / "project"
    if not args.project:
        if proj.exists():
            shutil.rmtree(proj)
        make_project(proj)
    config = proj / "zigzagumap.json"
    before_cfg = json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}
    before_files = tree_digest(proj, {"zigzagumap.json"})
    before_rom = digest(rom)
    with tempfile.TemporaryDirectory(prefix="zzm-town-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(args.exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": str(rom), "project": str(proj)}, timeout=120)
            check_links(z, None, "project", "project")
        saved = json.loads((pathlib.Path(profile) / "settings.json").read_text(encoding="utf-8"))
        check(not saved.get("townLinks"), f"プロジェクトのときは個人設定に入れない（{saved.get('townLinks')}）")
    after = json.loads(config.read_text(encoding="utf-8"))
    tm = after.get("townMap", {})
    check(tm.get("sections", {}).get("0x58") == {"page": 0, "x": 10, "y": 5, "width": 1, "height": 1}
          and tm.get("maps", {}).get("3.0") == {"page": 0, "x": 2, "y": 2, "width": 3, "height": 2}, f"zigzagumap.json の townMap: {tm}")
    rest_before = {k: v for k, v in before_cfg.items() if k != "townMap"}
    rest_after = {k: v for k, v in after.items() if k != "townMap"}
    check(rest_before == rest_after, f"zigzagumap.json のほかの節と知らない項目は残る（{list(rest_after)}）")
    check(tree_digest(proj, {"zigzagumap.json"}) == before_files, f"zigzagumap.json 以外のファイル（maps\\regionmap.json など {len(before_files)} 個）は変わらない")
    check(digest(rom) == before_rom, "ROM は 1 バイトも変わらない")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project")
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--keep", help="作ったプロジェクトを残すフォルダ（省略で一時フォルダ）")
    ap.add_argument("--only", choices=["rom", "project"])
    args = ap.parse_args()
    args.exe = pathlib.Path(args.exe) if args.exe else None
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    rom = pathlib.Path(args.rom).resolve()
    with tempfile.TemporaryDirectory(prefix="zzm-town-work-", ignore_cleanup_errors=True) as tmp:
        work = pathlib.Path(args.keep) if args.keep else pathlib.Path(tmp)
        work.mkdir(parents=True, exist_ok=True)
        for name, run in (("rom", lambda: rom_only(args, shots, rom)), ("project", lambda: project(args, rom, work))):
            if args.only and args.only != name:
                continue
            try:
                run()
            except Exception as e:  # noqa: BLE001
                check(False, f"{name}: 例外 {e!r}")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
