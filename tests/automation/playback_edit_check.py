"""タイムラインの編集と .s の移動データへの書き戻しを確かめる（#458）。

プロジェクトの写しを作業フォルダに作り（元のフォルダには書かない）、確かめ用の .s を足してから再生し、箱を編集する。
開いていないとき、エディタで開いているとき、未保存の変更があるとき、外で変わっていたとき、共用のラベル、
編集できない箱、メインの元に戻す・やり直すを確かめる。

    python tests/automation/playback_edit_check.py --exe <zigzagumap.exe> --rom <BPRJ.gba> --project <ND の写し> --work <作業フォルダ>
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import tempfile
import time

from zz import AppError, Zigzagu

COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json", "BPRJ.ld"]
SCRIPT = "assembly/overworld_scripts/zz_edit.s"
W = {"window": "script-editor"}
SOURCE = """ZzEditMain:
\tapplymovement 0xFF ZzEdit_Walk
\twaitmovement 0
\tapplymovement 0xFF ZzEdit_Shared
\twaitmovement 0
\tapplymovement 0xFF ZzEdit_If
\twaitmovement 0
\tend

ZzEditOther:
\tapplymovement 0xFF ZzEdit_Shared
\twaitmovement 0
\tend

ZzEdit_Walk: .byte walk_up, walk_up, walk_left, end_m @ 3 歩
ZzEdit_Shared:
\t.byte walk_down
\t.byte 0x13
\t.byte end_m
.if 1
ZzEdit_If: .byte walk_up, end_m
.endif
"""


def prepare(src: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    src, work = src.resolve(), work.resolve()
    if work == src or src in work.parents:
        raise SystemExit(f"作業フォルダが元のフォルダの中です: {work}")
    dst = work / "project"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for d in COPY_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d)
    for f in COPY_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    (dst / SCRIPT).write_bytes(SOURCE.encode("utf-8"))
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--work", required=True)
    a = ap.parse_args()
    project = prepare(pathlib.Path(a.project), pathlib.Path(a.work))
    disk = lambda: (project / SCRIPT).read_bytes().decode("utf-8")  # noqa: E731

    with tempfile.TemporaryDirectory(prefix="zzm-edit-", ignore_cleanup_errors=True) as tmp:
        with Zigzagu(a.exe, profile=pathlib.Path(tmp) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=a.rom, project=str(project)))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))

            def start():
                z.call(dict(cmd="playback.start", label="ZzEditMain"))
                return z.call(dict(cmd="playback.timeline"))

            def seg(timeline, label, step):
                return next(i for i, s in enumerate(timeline["segments"]) if s["movementLabel"] == label and s["stepIndex"] == step)

            def edit(segment, e, shared=None):
                req = dict(cmd="playback.edit", segment=segment, edit=e)
                if shared:
                    req["shared"] = shared
                return z.call(req)

            def history():
                return z.call(dict(cmd="editHistory.state"))["position"]

            # 1. 編集できない箱（.if の中）
            timeline = start()
            locks = z.call(dict(cmd="playback.locks"))
            locked = seg(timeline, "ZzEdit_If", 0)
            assert locks[locked] and ".if" in locks[locked], locks
            assert all(lock is None for i, lock in enumerate(locks) if i != locked), locks
            layout = z.call(dict(cmd="playback.layout"))
            assert [b["locked"] for b in sorted(layout["segments"], key=lambda b: b["index"])] == [lock is not None for lock in locks]
            try:
                edit(locked, dict(type="delete", index=0))
                raise AssertionError("編集できない箱を書き換えた")
            except AppError as e:
                assert ".if" in str(e)
            assert disk() == SOURCE
            print("OK .if の中の移動データは編集できない印と理由")

            # 2. 開いていないとき: 向きを変えると .s の移動データだけが変わり、書き方とコメントが残る。フレームを保つ
            z.call(dict(cmd="playback.seek", frame=20))
            h0 = history()
            done = edit(seg(timeline, "ZzEdit_Walk", 0), dict(type="direction", index=0, direction="right"))
            assert done["result"]["changed"] == [SCRIPT] and done["state"]["frame"] == 20, done
            first = SOURCE.replace("ZzEdit_Walk: .byte walk_up, walk_up", "ZzEdit_Walk: .byte walk_right, walk_up")
            assert disk() == first, disk()
            after = z.call(dict(cmd="playback.timeline"))
            assert after["segments"][seg(after, "ZzEdit_Walk", 0)]["movementId"] == 0x13
            assert history() == h0 + 1
            print("OK 開いていないファイル: 移動データの値だけ書き換え、コメントと書き方を保ち、フレームを保つ")

            # 3. メインの元に戻す・やり直すで .s とタイムラインが戻る
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, SOURCE)
            back = z.call(dict(cmd="playback.timeline"))
            assert back["segments"][seg(back, "ZzEdit_Walk", 0)]["movementId"] == 0x11
            z.call(dict(cmd="redo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, first)
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, SOURCE)
            print("OK メインの元に戻す・やり直すで .s とタイムラインが戻る")

            # 4. 共用のラベル: 写す（このスクリプトだけ付け替える）と、そのまま書き換える（1 行 1 命令の形を保つ）
            timeline = z.call(dict(cmd="playback.timeline"))
            shared = seg(timeline, "ZzEdit_Shared", 0)
            copied = edit(shared, dict(type="delete", index=0), shared="copy")
            assert copied["result"]["newLabel"] == "ZzEdit_Shared_2", copied
            text = disk()
            assert "\tapplymovement 0xFF ZzEdit_Shared_2\n" in text and "ZzEditOther:\n\tapplymovement 0xFF ZzEdit_Shared\n" in text, text
            assert "\t.byte end_m\nZzEdit_Shared_2: .byte 0x13, end_m\n" in text or "\t.byte end_m\nZzEdit_Shared_2: .byte walk_right, end_m\n" in text, text
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, SOURCE)
            timeline = z.call(dict(cmd="playback.timeline"))
            rewrite = edit(seg(timeline, "ZzEdit_Shared", 1), dict(type="repeat", index=1, count=2), shared="rewrite")
            assert rewrite["result"]["newLabel"] is None
            text = disk()
            assert "ZzEdit_Shared:\n\t.byte walk_down\n\t.byte 0x13\n\t.byte 0x13\n\t.byte end_m\n" in text or "ZzEdit_Shared:\n\t.byte walk_down\n\t.byte 0x13\n\t.byte walk_right\n\t.byte end_m\n" in text, text
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, SOURCE)
            print("OK 共用のラベルを、新しいラベルに写して付け替える・そのまま書き換える（1 行 1 命令の形）")

            # 5. エディタで開いている（未保存の変更なし）: エディタの本文に入り、保存される
            z.call(dict(cmd="script.open", path=SCRIPT))
            wait_editor(z)
            timeline = start()
            edit(seg(timeline, "ZzEdit_Walk", 2), dict(type="insert", index=2, value=0x10))
            editor_text = z.call(dict(cmd="editor.text", path=SCRIPT, **W))["text"]
            want = SOURCE.replace("walk_up, walk_up, walk_left, end_m", "walk_up, walk_up, walk_down, walk_left, end_m")
            assert editor_text == want, editor_text
            wait_disk(disk, want)
            assert not z.call(dict(cmd="editor.state", **W))["dirty"]
            # エディタの Ctrl+Z の履歴にも入っている
            z.call(dict(cmd="editor.activate", path=SCRIPT, **W))
            z.call(dict(cmd="editor.key", key="z", ctrl=True, **W))
            wait_editor_text(z, SOURCE)
            z.call(dict(cmd="editor.key", key="y", ctrl=True, **W))
            wait_editor_text(z, want)
            z.call(dict(cmd="playback.settled"))
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_disk(disk, SOURCE)
            wait_editor_text(z, SOURCE)
            print("OK エディタで開いているファイル: エディタの本文に入って保存され、メインの元に戻すで戻る")

            # 6. 未保存の変更があるとき: エディタの本文にだけ入り、保存しない
            dirty_text = SOURCE + "@ 未保存の行\n"
            z.call(dict(cmd="editor.activate", path=SCRIPT, **W))
            z.call(dict(cmd="editor.setText", text=dirty_text, **W))
            timeline = start()
            edit(seg(timeline, "ZzEdit_Walk", 1), dict(type="delete", index=1))
            editor_text = z.call(dict(cmd="editor.text", path=SCRIPT, **W))["text"]
            assert editor_text == dirty_text.replace("walk_up, walk_up, walk_left", "walk_up, walk_left"), editor_text
            assert disk() == SOURCE and z.call(dict(cmd="editor.state", **W))["dirty"]
            z.call(dict(cmd="undo"))
            z.call(dict(cmd="playback.settled"))
            wait_editor_text(z, dirty_text)
            assert disk() == SOURCE
            z.call(dict(cmd="editor.setText", text=SOURCE, **W))
            z.call(dict(cmd="editor.save", **W))
            z.call(dict(cmd="editor.closeTab", path=SCRIPT, **W))
            print("OK 未保存の変更があるファイル: エディタの本文にだけ入り、保存しない")

            # 7. 外で変わっていたとき: 書かずに知らせ、読み直して計算し直す
            timeline = start()
            h1 = history()
            outside = SOURCE.replace("walk_up, walk_up, walk_left", "walk_left, walk_up, walk_up")
            (project / SCRIPT).write_bytes(outside.encode("utf-8"))
            stale = edit(seg(timeline, "ZzEdit_Walk", 0), dict(type="delete", index=0))
            assert stale["result"] is None and disk() == outside and history() == h1, stale
            status = z.call(dict(cmd="state"))["status"]
            assert "変わっていた" in status["left"], status
            again = z.call(dict(cmd="playback.timeline"))
            assert again["segments"][seg(again, "ZzEdit_Walk", 0)]["movementId"] == 0x12
            print("OK 外で変わっていたファイルは書かずに知らせ、読み直して計算し直す")

            # 8. 画面の操作: 右クリックのメニュー、Alt＋矢印、Delete、ドラッグで並べ替え
            def box(step):
                timeline = z.call(dict(cmd="playback.timeline"))
                index = seg(timeline, "ZzEdit_Walk", step)
                layout = z.call(dict(cmd="playback.layout"))
                order = next(i for i, b in enumerate(layout["segments"]) if b["index"] == index)
                return f"playback.segment.{order}", layout["segments"][order]

            def walk_line():
                return next(line for line in disk().splitlines() if line.startswith("ZzEdit_Walk:"))

            h2 = history()
            auto, _ = box(0)
            z.call(dict(cmd="mouse", id=auto, action="rightClick", px=[4, 4]))
            z.call(dict(cmd="contextMenu.press", id="playback.edit.right"))
            z.call(dict(cmd="playback.settled"))
            wait_line(walk_line, "ZzEdit_Walk: .byte walk_right, walk_up, walk_up, end_m @ 3 歩")
            auto, _ = box(1)
            z.call(dict(cmd="mouse", id=auto, action="click", px=[4, 4]))
            z.call(dict(cmd="key", id=auto, key="ArrowDown", alt=True))
            z.call(dict(cmd="playback.settled"))
            wait_line(walk_line, "ZzEdit_Walk: .byte walk_right, walk_down, walk_up, end_m @ 3 歩")
            auto, _ = box(2)
            z.call(dict(cmd="mouse", id=auto, action="click", px=[4, 4]))
            z.call(dict(cmd="key", id=auto, key="Delete"))
            z.call(dict(cmd="playback.settled"))
            wait_line(walk_line, "ZzEdit_Walk: .byte walk_right, walk_down, end_m @ 3 歩")
            auto, own = box(1)
            _, target = box(0)
            z.call(dict(cmd="mouse", id=auto, action="drag", px=[own["width"] / 2, 4], toPx=[target["left"] - own["left"] + own["width"] / 2, 4], steps=4))
            z.call(dict(cmd="playback.settled"))
            wait_line(walk_line, "ZzEdit_Walk: .byte walk_down, walk_right, end_m @ 3 歩")
            assert history() == h2 + 4
            for _ in range(4):
                z.call(dict(cmd="undo"))
                z.call(dict(cmd="playback.settled"))
            wait_disk(disk, outside)
            print("OK 右クリックのメニュー、Alt＋矢印、Delete、ドラッグの並べ替えで書き換え、4 回の元に戻すで戻る")
            z.call(dict(cmd="playback.stop"))
    print("OK 終了")


def wait_disk(disk, want, timeout=10):
    end = time.monotonic() + timeout
    while disk() != want:
        if time.monotonic() > end:
            raise AssertionError(f"ファイルが期待どおりにならない:\n{disk()}")
        time.sleep(0.1)


def wait_line(read, want, timeout=10):
    end = time.monotonic() + timeout
    while read() != want:
        if time.monotonic() > end:
            raise AssertionError(f"行が期待どおりにならない: {read()}")
        time.sleep(0.1)


def wait_editor(z, timeout=30):
    end = time.monotonic() + timeout
    while True:
        try:
            z.call(dict(cmd="editor.state", **W))
            return
        except AppError:
            if time.monotonic() > end:
                raise
            time.sleep(0.2)


def wait_editor_text(z, want, timeout=10):
    end = time.monotonic() + timeout
    while z.call(dict(cmd="editor.text", path=SCRIPT, **W))["text"] != want:
        if time.monotonic() > end:
            raise AssertionError("エディタの本文が期待どおりにならない")
        time.sleep(0.1)


if __name__ == "__main__":
    main()
