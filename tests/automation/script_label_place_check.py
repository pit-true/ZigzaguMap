"""ラベルの場所の判定（#554）を、Chronos と ND のコピーで確かめる。

  python tests/automation/script_label_place_check.py --chronos <Chronos のルートのコピー> --nd <NeoDark-CFRU-main のコピー>
      [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- コピーには書き込まない（出力しない。ラベルと対応表の変更は保存せずに閉じる）。
- Chronos（maps\\scripts.json が無い）: トキワシティ（3.1）は見本のラベルから「このマップの .s」が自動で決まり（#562）、
  人 9〜11 のラベル EventScript_ZzmPlaybackDemo に注意は出ない。一覧に出る。人 10 からスクリプトの再生を始められる。
- ND（maps\\scripts.json が無い）: 自動で決まらないよう 3.0 の .s を trainer_battle_scripts.s にしてから、3.0 の人に、共用のスクリプトの
  `.global` のラベル（EventScript_FollowerTalk）・`.global` でないほかのファイルのラベル（EventScript_debug_surf）・無いラベルを付け、
  順に「別のファイル（…）にあります」（赤い字にしない）・「.global でない」・「見つからない」が出る。
  3.0 の .s を 01_moegi.s にすると、EventScript_debug_surf はマップの .s のラベルになり、注意が消える。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
FIELD = "event.person.label"


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def field(z: Zigzagu, index: int) -> dict:
    z.call({"cmd": "event.select", "kind": "person", "index": index})
    z.call({"cmd": "script.settle"})
    return z.call({"cmd": "getField", "id": FIELD})


def person(z: Zigzagu, index: int) -> dict:
    return next(p for p in z.call({"cmd": "script.labels"})["person"] if p["index"] == index)


def list_items(z: Zigzagu, text: str) -> list[str]:
    z.call({"cmd": "ui.type", "id": FIELD, "text": text, "blur": False})
    items = [str(x["id"]).split(":", 1)[1] for x in z.call({"cmd": "ui.list", "root": f"{FIELD}.list"}) if str(x.get("id", "")).startswith(f"{FIELD}.option:")]
    z.call({"cmd": "key", "id": FIELD, "key": "Escape"})
    return items


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if shots:
        data = z.call({"cmd": "screenshot"})
        (shots / f"{name}.png").write_bytes(base64.b64decode(data["png"] if isinstance(data, dict) else data))


def chronos(z: Zigzagu, root: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "openFolder", "folder": str(root)}, timeout=300)
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    z.call({"cmd": "tab", "name": "event"})
    labels = z.call({"cmd": "script.labels"})
    demo = [p for p in labels["person"] if p["label"] == "EventScript_ZzmPlaybackDemo"]
    check(len(demo) == 3, f"Chronos 3.1 に見本のラベルの人が 3 人いる（{[p['index'] for p in demo]}）")
    # maps\\scripts.json は無いが、見本のラベルから「このマップの .s」が自動で決まる（#562）
    check(labels["scriptFrom"] == "auto" and str(labels["script"]).endswith("zigzagu_playback_demo_scripts.s"), f"マップの .s は自動で決まる（{labels['script']}）")
    check(all(p["inScript"] and p["place"] == "map" for p in demo), f"見本のラベルはマップの .s のラベル（{[(p['place'], p['file']) for p in demo]}）")
    for p in demo:
        f = field(z, p["index"])
        check("missing" not in f["classes"] and f["title"] == "EventScript_ZzmPlaybackDemo", f"人 {p['index']} の欄に注意が出ない（{f['title']}）")
    shot(z, shots, "chronos-field")
    items = list_items(z, "ZzmPlayback")
    check("EventScript_ZzmPlaybackDemo" in items, f"一覧に見本のラベルが出る（{items[:5]}）")
    z.call({"cmd": "playback.start", "kind": "person", "index": demo[1]["index"]}, timeout=180)
    st = z.call({"cmd": "playback.state"})
    check(st.get("active") is True and st.get("entry") == "EventScript_ZzmPlaybackDemo", f"人 {demo[1]['index']} からスクリプトの再生を始められる（{st.get('entry')}）")
    shot(z, shots, "chronos-playback")
    z.call({"cmd": "playback.stop"})


def nd(z: Zigzagu, root: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "openFolder", "folder": str(root)}, timeout=300)
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    # ラベルから自動で決まらないように、3.0 の .s を trainer_battle_scripts.s に決めておく（保存しない）
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 3, "map": 0, "name": "ZzPlace", "script": "assembly/overworld_scripts/trainer_battle_scripts.s", "strings": None}})
    cases = [
        ("EventScript_FollowerTalk", "global", False, "別のファイル（follower_scripts.s）にあります"),
        ("EventScript_debug_surf", "notGlobal", True, ".global でないので"),
        ("EventScript_ZzNoSuchLabel", "missing", True, "見つかりません"),
    ]
    for label, place, red, text in cases:
        z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "person", "index": 0, "label": label})
        p = person(z, 0)
        f = field(z, 0)
        check(p["place"] == place and p["inScript"] == (not red), f"ND の {label} は {place}（{p['place']}・{p['file']}）")
        check(("missing" in f["classes"]) == red and text in f["title"], f"ND の {label} の欄（赤い字 {red}）: {f['title']}")
        shot(z, shots, f"nd-{place}")
    items = list_items(z, "SystemScript_Enable")
    check("SystemScript_EnableAutoRun" in items, f"ND の一覧に system_scripts.s の .global のラベルが出る（{items[:4]}）")
    # 対応表で 3.0 に 01_moegi.s を紐づける（保存しない）と、.global でなくてもマップの .s のラベル
    z.call({"cmd": "scripts.table", "action": "set", "index": 0, "entry": {"bank": 3, "map": 0, "name": "ZzPlace", "script": "assembly/overworld_scripts/01_moegi.s", "strings": None}})
    z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "person", "index": 0, "label": "EventScript_debug_surf"})
    p = person(z, 0)
    f = field(z, 0)
    check(p["place"] == "map" and p["inScript"] and "missing" not in f["classes"] and f["title"] == "EventScript_debug_surf",
          f"マップの .s のラベルは .global でなくても注意しない（{p['place']}・{f['title']}）")
    items = list_items(z, "")
    moegi = [i for i, n in enumerate(items) if n == "EventScript_debug_surf"]
    shared = [i for i, n in enumerate(items) if n == "EventScript_FollowerTalk"]
    check(bool(moegi) and (not shared or moegi[0] < shared[0]), f"一覧はマップの .s のラベルが先（{items[:3]}）")
    for _ in range(6):
        z.call({"cmd": "undo"})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chronos", required=True)
    ap.add_argument("--nd", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-place-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(pathlib.Path(args.exe) if args.exe else None, profile=profile) as z:
            chronos(z, pathlib.Path(args.chronos), shots)
            nd(z, pathlib.Path(args.nd), shots)
    print("結果: " + ("すべて OK" if not failures else f"失敗 {len(failures)} 件"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
