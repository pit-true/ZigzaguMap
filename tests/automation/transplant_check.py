"""別の ROM からタイルセットを取り込む窓（#314）を、ROM の写しだけで確かめる。

  python tests/automation/transplant_check.py --rom <素の BPRJ> --source <取り込む元の ROM> [--source ...] [--exe <zigzagumap.exe>]
      [--shots <フォルダ>] [--work <出力の作業フォルダ>] [--memory]

- ツール > 別の ROM からタイルセットを取り込む で窓を開き、元の ROM を選ぶとマップの一覧が出る。
- 元の ROM の 3.1（エメラルドなら 0.9）を選ぶと、取り込んだ後の絵・主と副の情報・変わることの一覧が出る。
- 「両方」「配置も写す」で取り込むと、メインの 3.0 の組が新しいタイルセット（0x09F00000〜）に変わり、大きさと配置も元のマップと同じになる。
  1 回の「元に戻す」で組・配置・新しいタイルセットが全部戻る。やり直して出力すると、`New: true` の tileset.json が 2 つ書かれる。
- 「主だけ」で取り込むと主だけが変わる。
- `--memory` を付けると、窓を開く前・元の ROM を開いた後・窓を閉じた後のメモリ（専用ワーキングセットの合計、MB）を測る。
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu, wait_window  # noqa: E402

failures: list[str] = []
TP = "transplant"
TARGET = {"bank": 3, "map": 0}


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what, flush=True)
    if not cond:
        failures.append(what)


def save_shot(z: Zigzagu, shots: pathlib.Path | None, name: str, window: str | None = None) -> None:
    if not shots:
        return
    req: dict = {"cmd": "screenshot"}
    if window:
        req["window"] = window
    png = z.call(req)
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def tp(z: Zigzagu, req: dict):
    return z.call({**req, "window": TP})


def private_mb(pid: int) -> float:
    """exe とその子孫（WebView2）の専用ワーキングセットの合計（MB）。"""
    ps = (
        "$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId;"
        f"$ids = New-Object System.Collections.Generic.List[int]; $ids.Add({pid}); $c = $true;"
        "while ($c) { $c = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $c = $true } } };"
        "$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess,WorkingSetPrivate;"
        "($perf | Where-Object { $ids.Contains([int]$_.IDProcess) } | Measure-Object -Property WorkingSetPrivate -Sum).Sum"
    )
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.strip()
    return float(out or 0) / 1024 / 1024


def open_window(z: Zigzagu) -> None:
    z.call({"cmd": "action", "id": "tools.transplant"})
    check(wait_window(z, TP), "ツール > 別の ROM からタイルセットを取り込む で窓が開く")


def pick_rom(z: Zigzagu, path: str) -> dict:
    tp(z, {"cmd": "queuePath", "path": path})
    tp(z, {"cmd": "click", "id": "tp.pickRom"})
    for _ in range(100):
        s = tp(z, {"cmd": "state"})
        if s["mapCount"] > 0:
            return s
        time.sleep(0.2)
    return tp(z, {"cmd": "state"})


def select_map(z: Zigzagu, bank: int, map_: int) -> dict:
    return tp(z, {"cmd": "transplant.select", "bank": bank, "map": map_})


def main_state(z: Zigzagu) -> dict:
    return z.call({"cmd": "state"})


def current_pair(z: Zigzagu) -> tuple[int, int]:
    m = main_state(z)["map"]
    return m["primaryTileset"], m["secondaryTileset"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--source", action="append", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    p.add_argument("--work")
    p.add_argument("--memory", action="store_true")
    a = p.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-transplant-"))
    work.mkdir(parents=True, exist_ok=True)

    for source in a.source:
        print(f"== {source}")
        profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-"))
        with Zigzagu(a.exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": a.rom})
            z.call({"cmd": "selectMap", **TARGET})
            before = current_pair(z)
            size_before = (main_state(z)["map"]["width"], main_state(z)["map"]["height"])
            mem0 = mem1 = 0.0
            if a.memory:
                time.sleep(10)
                mem0 = private_mb(z.proc.pid)
            open_window(z)
            s = pick_rom(z, source)
            check(s["mapCount"] > 400, f"元の ROM（{s['game']}）のマップの一覧が出る（{s['mapCount']} 枚）")
            emerald = (s["game"] or "").startswith("BPE")
            src = (0, 9) if emerald else (3, 1)
            s = select_map(z, *src)
            check(s["selected"] == {"bank": src[0], "map": src[1]}, f"{src[0]}.{src[1]} を選べる")
            conv = s["conversion"]
            check(conv is not None and conv["primary"]["blocks"] > 0 and conv["secondary"]["blocks"] > 0, f"主と副の情報が出る（{conv and (conv['primary'], conv['secondary'])}）")
            info = tp(z, {"cmd": "getField", "id": "tp.primaryInfo"})["value"]
            check("ブロック" in info and "アニメ" in info, f"主タイルセットの情報（{info!r}）")
            check(len(s["report"]) >= 2, f"変わることの一覧（{s['report']}）")
            if emerald:
                check(any("エメラルドから" in line for line in s["report"]), "エメラルドから変えることが一覧に出る")
            preview = tp(z, {"cmd": "canvasPng", "id": "tp.preview"})
            check(preview["width"] > 16 and preview["height"] > 16, f"取り込んだ後の絵（{preview['width']}×{preview['height']}）")
            if a.memory:
                time.sleep(10)
                mem1 = private_mb(z.proc.pid)
            tp(z, {"cmd": "setField", "id": "tp.copyLayout", "value": True})
            s = tp(z, {"cmd": "state"})
            check(any("配置とボーダーもコピーします" in line for line in s["report"]), "「配置も写す」で一覧に配置の行が出る")
            save_shot(z, shots, f"tile_transplant_{s['game']}.png", TP)
            history = main_state(z)["history"]
            tp(z, {"cmd": "click", "id": "tp.import"})
            time.sleep(1.0)
            after = current_pair(z)
            m = main_state(z)["map"]
            check(after[0] != before[0] and after[1] != before[1] and after[0] >= 0x09F00000, f"取り込むとメインの組が新しいタイルセットになる（{after[0]:#x}, {after[1]:#x}）")
            check(main_state(z)["history"] == history + 1, "取り込みは 1 回の操作")
            check([m["width"], m["height"]] == s["selectedSize"], f"配置も写すと大きさが元のマップと同じ（{m['width']}×{m['height']}、元 {s['selectedSize']}）")
            save_shot(z, shots, f"tile_transplant_main_{s['game']}.png")
            z.call({"cmd": "undo"})
            time.sleep(0.5)
            check(current_pair(z) == before, "1 回の「元に戻す」で組が戻る")
            m = main_state(z)["map"]
            check((m["width"], m["height"]) == size_before, "1 回の「元に戻す」で大きさも戻る")
            z.call({"cmd": "redo"})
            time.sleep(0.5)
            out = work / f"{s['game']}-{time.strftime('%Y%m%d-%H%M%S')}"
            out.mkdir(parents=True, exist_ok=True)
            res = z.call({"cmd": "export", "dir": str(out)})
            infos = [x for x in res["written"] if x.replace("\\", "/").endswith("tileset.json")]
            news = [json.loads((out / x).read_text(encoding="utf-8")) for x in infos]
            check(len(news) == 2 and all(n.get("New") for n in news), f"出力すると New のタイルセットが 2 つ書かれる（{infos}）")
            # 主だけ
            z.call({"cmd": "undo"})
            time.sleep(0.5)
            tp(z, {"cmd": "setField", "id": "tp.parts", "value": 1})
            tp(z, {"cmd": "setField", "id": "tp.copyLayout", "value": False})
            s = tp(z, {"cmd": "state"})
            check(s["parts"] == "primary" and s["conversion"]["secondary"] is None, "「主だけ」にすると副は取り込まない")
            tp(z, {"cmd": "click", "id": "tp.import"})
            time.sleep(1.0)
            after = current_pair(z)
            check(after[0] != before[0] and after[1] == before[1], f"「主だけ」は主だけが変わる（{after[0]:#x}, {after[1]:#x}）")
            z.call({"cmd": "undo"})
            # 「閉じる」ボタンはウィンドウごと消えて返事が返らないので、押す前の状態だけ見て、閉じるのは close 命令で行う
            check(tp(z, {"cmd": "getField", "id": "tp.close"})["enabled"], "「閉じる」ボタンがある")
            z.call({"cmd": "close", "window": TP})
            check(wait_window(z, TP, present=False), "窓が閉じる")
            if a.memory:
                time.sleep(10)
                mem2 = private_mb(z.proc.pid)
                # WebView2 の GC の時期で数 MB ぶれるので、超えたときは 10 秒ずつ 2 回まで測り直し、いちばん小さい値で見る
                for _ in range(2):
                    if mem2 <= mem0 + 10:
                        break
                    time.sleep(10)
                    again = private_mb(z.proc.pid)
                    print(f"メモリの測り直し: {mem2:.1f} → {again:.1f}MB")
                    mem2 = min(mem2, again)
                print(f"メモリ（専用ワーキングセットの合計）: 開く前 {mem0:.1f}MB / 元の ROM を開いた後 {mem1:.1f}MB / 閉じた後 {mem2:.1f}MB")
                check(mem2 <= mem0 + 10, f"窓を閉じるとメモリが開く前と同じくらいに戻る（{mem0:.1f} → {mem2:.1f}MB）")

    print()
    print("失敗:", len(failures))
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
