r"""AdvanceMap で全マップの「マップ画像の保存」（--events なら「マップ&イベント画像の保存」）を行う。

usage: python export_map_images.py OUTDIR [--maps B.M ...] [--events]
  -> OUTDIR\m<B>_<M>.DIB（--events では me<B>_<M>.DIB）と OUTDIR\export.log
既にあるファイルは飛ばすので、止まったら同じコマンドで続きから動く。
ZZM_AM_DIR / ZZM_ROM は README の「準備」のとおり。core 側との比較は
`pnpm --filter @zigzagumap/core compare-map-images -- <rom> OUTDIR`。
"""
from __future__ import annotations

import argparse
import pathlib
import re
import time

from am import AM


def map_ids(am: AM) -> list[tuple[int, int]]:
    ids: list[tuple[int, int]] = []
    for it in am.map_items():
        m = re.search(r"\((\d+)\.(\d+)\)$", it["text"])
        if m and (int(m[1]), int(m[2])) not in ids:
            ids.append((int(m[1]), int(m[2])))
    return sorted(ids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--maps", nargs="*")
    ap.add_argument("--events", action="store_true")
    a = ap.parse_args()
    out = pathlib.Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    log = open(out / "export.log", "a", encoding="utf-8")

    def note(*xs):
        print(*xs, file=log, flush=True)

    prefix = "me" if a.events else "m"
    item = "マップ&イベント画像の保存" if a.events else "マップ画像の保存"
    am = AM()
    try:
        am.start()
        ids = [tuple(map(int, s.split("."))) for s in a.maps] if a.maps else map_ids(am)
        note("maps", len(ids))
        tab_set = False
        for b, m in ids:
            dst = out / f"{prefix}{b}_{m}.DIB"
            if dst.exists() and dst.stat().st_size > 0:
                continue
            try:
                if not am.select_map(b, m):
                    note("select failed", b, m, am.dismiss_dialogs(button_pref=("OK", "キャンセル")))
                    continue
                if a.events and not tab_set:
                    am.tab("event")
                    tab_set = True
                time.sleep(0.2)
                am.menu("ツール", item)
                if not am.file_dialog(str(dst.with_suffix(""))):
                    note("no dialog", b, m)
                    continue
                t0 = time.time()
                while time.time() - t0 < 5 and not (dst.exists() and dst.stat().st_size > 0):
                    time.sleep(0.1)
                left = am.dismiss_dialogs(button_pref=("OK", "キャンセル"))
                note("ok" if dst.exists() else "missing", b, m, left or "")
            except Exception as e:  # noqa: BLE001 - 1 枚の失敗で全体を止めない
                note("error", b, m, repr(e))
                if not am.alive() or am.hung():
                    am.kill()
                    am.start()
                    tab_set = False
    finally:
        am.shutdown()


if __name__ == "__main__":
    main()
