"""アプリごとのドライバー（抽象操作 → 実操作）。

どちらも `run_step(step)` が StepResult を返す:
  status: "ok" | "emulated"（別の手段で代用） | "unsupported"（未対応） | "error"
  obs:    observe 系の操作で読んだもの（snapshot は画像のパス、compareFields は値の dict、expectDialog はダイアログ一覧）
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from .config import HARNESS, Config
from .screens import form_class, zigzagu_window

TAB_NAMES = ["map", "movement", "event", "wild", "header"]
SORT_LABELS = ["バンク番号で並び替え", "マップの名前で並び替え", "タイルセット番号で並び替え",
               "タイルセットのグループで並び替え", "マップとタイルセットで並び替え"]


class Unsupported(Exception):
    """この操作はこのアプリでは（まだ）できない。"""


@dataclass
class StepResult:
    status: str = "ok"
    note: str = ""
    obs: dict = field(default_factory=dict)
    seconds: float = 0.0


def _xy(v):
    return int(v[0]), int(v[1])


def drag_cells(p0, p1, steps=8, cell=16):
    """左ドラッグで通るマス（AdvanceMap のハーネスと同じく、マスの中央どうしを steps 段階で動かしたときの位置）。"""
    x0, y0 = p0[0] * cell + cell // 2, p0[1] * cell + cell // 2
    x1, y1 = p1[0] * cell + cell // 2, p1[1] * cell + cell // 2
    out = [(p0[0], p0[1])]
    for i in range(1, steps + 1):
        c = ((x0 + (x1 - x0) * i // steps) // cell, (y0 + (y1 - y0) * i // steps) // cell)
        if c not in out:
            out.append(c)
    return out


class Driver:
    name = "base"
    label = "base"
    # 抽象操作 → 実操作の説明（None は未対応）。--list-ops で表に出す。
    MAPPING: dict[str, str | None] = {}

    def __init__(self, cfg: Config, out_dir: pathlib.Path):
        self.cfg, self.out = cfg, out_dir
        self.out.mkdir(parents=True, exist_ok=True)

    def run_step(self, step: dict) -> StepResult:
        op = step["op"]
        fn = getattr(self, "op_" + op, None)
        t0 = time.time()
        if fn is None or self.MAPPING.get(op, "") is None:
            return StepResult("unsupported", f"{self.label} の未対応の操作: {op}")
        try:
            r = fn(step)
            if isinstance(r, StepResult):
                res = r
            else:
                res = StepResult("ok", obs=r or {})
        except Unsupported as e:
            res = StepResult("unsupported", str(e))
        except Exception as e:  # noqa: BLE001
            res = StepResult("error", f"{type(e).__name__}: {e}")
        res.seconds = round(time.time() - t0, 2)
        return res

    def op_wait(self, step):
        time.sleep(float(step.get("seconds", 0.5)))


# ============================================================================ AdvanceMap
class AdvanceMapDriver(Driver):
    name = "advancemap"
    label = "AdvanceMap"
    MAPPING = {
        "openRom": "ファイル > ROMを開く → ファイルダイアログに作業用 ROM を入れて OK",
        "selectMap": "MapList（ツリー）で選んで Enter（だめならダブルクリック）",
        "selectTab": "TabbedNotebook1 の見出しをクリック",
        "sortTree": "設定 > マップの表示設定 > ヘッダーのソート > 各項目",
        "selectBlock": "BlockPalette を左クリック（8 個/行）",
        "pickPaletteStamp": "BlockPalette を Ctrl＋右ドラッグ",
        "paintBlock": "MapBox を左クリック",
        "dragPaint": "MapBox を左ドラッグ（マウス移動 steps 回）",
        "pickBlock": "MapBox を右クリック",
        "pickStamp": "MapBox を Ctrl＋右ドラッグ",
        "paintBorder": "RandBox2 を左クリック",
        "pickBorder": "RandBox2 を右クリック",
        "hover": "MapBox / GehBox / EventBox へ WM_MOUSEMOVE",
        "selectMovement": "GehPalette を左クリック（1 個/行）",
        "paintMovement": "GehBox を左クリック",
        "dragMovement": "GehBox を左ドラッグ",
        "pickMovement": "GehBox を右クリック",
        "menu": "メインメニューの WM_COMMAND",
        "setField": "入力欄に WM_SETTEXT / コンボに CB_SETCURSEL＋CBN_SELCHANGE（Delphi 部品名で指定）",
        "clickButton": "ボタンに BM_CLICK（Delphi 部品名で指定）",
        "clickEvent": "EventBox を左クリック",
        "clickComp": "部品（ウィンドウの無い TDXPaintBox も）へ WM_LBUTTONDOWN/UP（親の座標に換算）",
        "dragEvent": "EventBox を左ドラッグ",
        "answerDialog": "ダイアログのボタンに BM_CLICK",
        "answerFile": "ファイルのダイアログのファイル名の欄に結果フォルダの中のパスを入れて OK",
        "compareFile": "書かれたファイルを読む",
        "export": "ファイル > ROMの保存（作業用コピーに書く）",
        "wait": "待つ",
        "snapshot": "部品をスクロールしながら PrintWindow で切り出してつなぐ",
        "compareFields": "ステータスバー・題名・ツリー・メニュー・部品をメッセージとプロセスメモリで読む",
        "expectDialog": "このプロセスの見えているダイアログ（#32770 と VCL のフォーム）",
    }
    COMP = {"map": "MapBox", "blocks": "MapBox", "movement": "GehBox", "event": "EventBox",
            "border": "RandBox2", "palette": "BlockPalette", "movementPalette": "GehPalette"}
    TAB_OF = {"map": 0, "blocks": 0, "movement": 1, "event": 2, "border": 0, "palette": 0, "movementPalette": 1}

    def __init__(self, cfg, out_dir, rom: pathlib.Path):
        super().__init__(cfg, out_dir)
        if str(HARNESS) not in sys.path:
            sys.path.insert(0, str(HARNESS))
        import am as amlib  # noqa: E402
        import make_worker  # noqa: E402
        self.amlib, self.mw = amlib, make_worker
        self.rom = rom
        self.am = None

    # ------------------------------------------------------------------ lifecycle
    def start(self):
        cfg = self.cfg
        if not cfg.amWorkDir:
            raise SystemExit("amWorkDir（AdvanceMap の作業用コピー）を設定してください")
        if not (cfg.amWorkDir / "AdvanceMap.exe").exists():
            if not cfg.amSourceDir:
                raise SystemExit("amWorkDir に AdvanceMap.exe がありません。amSourceDir を指定するとコピーを作ります")
            self.mw.make_am_copy(cfg.amSourceDir, cfg.amWorkDir)
        if cfg.amSourceDir and (cfg.amSourceDir / "Ini" / "AdvanceMap.ini").exists():
            # 設定（高度なヘッダーの表示・並べ替え・コンボボックスなど、押した時点で Ini に書かれるもの）を毎回コピー元へ戻す
            shutil.copyfile(cfg.amSourceDir / "Ini" / "AdvanceMap.ini", cfg.amWorkDir / "Ini" / "AdvanceMap.ini")
        # 作成したマップの一覧（Ini\MapDateien.ini）は空から始める。AdvanceMap 1.92 の配布物には見本の 2 件（C:\AM\Maps の
        # Testmap_absolut / Testmap_relativ）が入っているが、ZigzaguMap の個人設定（mapFiles）は空から始まるので合わせる
        (cfg.amWorkDir / "Ini" / "MapDateien.ini").write_bytes(b"")
        self.mw.prep_ini(cfg.amWorkDir, None, cfg.scriptEditorStub)
        self.mw.reset_view_settings(cfg.amWorkDir)
        self.am = self.amlib.AM(desktop_name=f"ZZM_CMP_{os.getpid()}", am_dir=cfg.amWorkDir, shots=self.out)
        self.am.start(rom=None)
        time.sleep(1.0)
        if not self.am.main:
            raise RuntimeError("AdvanceMap のメインウィンドウが出ません")
        # 大きな窓にして、マップをなるべくスクロールせずに取れるようにする（隠しデスクトップの中だけ）
        self.am.move_window(self.am.main, 0, 0, 2400, 1600)
        time.sleep(0.5)
        self._diverged_tab = None

    def stop(self):
        if self.am:
            try:
                # 止めた音の回数（鳴るはずだった回数）を残す
                self.sound = self.am.sound_counts()
            except Exception:  # noqa: BLE001
                self.sound = None
            try:
                self.am.shutdown()
            finally:
                self.am = None

    # ------------------------------------------------------------------ helpers
    def _busy_dialog(self):
        """モーダルが開いたままだと以後の操作が通らないので、残っていれば記録する。"""
        return [self.am.dialog_info(h) for h in self.am.msgboxes()]

    def _scroll_to(self, comp: str, px: int, py: int):
        """部品の中の画素 (px, py) が見えるように親のスクロールボックスを動かす。"""
        am = self.amlib
        d = self.am.comp(comp)
        h, ox, oy = self.am._host(d)
        if not h:
            return
        cl, ct, cr, cb = am.client_rect_of(h)
        vx, vy = ox + px, oy + py
        if 0 <= vx < cr and 0 <= vy < cb:
            return
        # 現在のスクロール量 = -(部品の左上)。見たい位置が中央に来るようにする。
        cur_x, cur_y = -min(ox, 0), -min(oy, 0)
        if not (0 <= vy < cb):
            pos = max(0, cur_y + vy - cb // 2)
            self.am.send(h, am.WM_VSCROLL, (pos << 16) | 4, 0)
            self.am.send(h, am.WM_VSCROLL, 8, 0)
        if not (0 <= vx < cr):
            pos = max(0, cur_x + vx - cr // 2)
            self.am.send(h, am.WM_HSCROLL, (pos << 16) | 4, 0)
            self.am.send(h, am.WM_HSCROLL, 8, 0)
        time.sleep(0.1)
        self.am.idle()

    def _cell_px(self, comp, bx, by):
        d = self.am.comp(comp)
        block = self.am._guess_block(comp, d) if comp in ("MapBox", "GehBox", "EventBox") else 16
        return bx * block + block // 2, by * block + block // 2

    def _click_cell(self, comp, bx, by, button="left", keys=0):
        px, py = self._cell_px(comp, bx, by)
        self._scroll_to(comp, px, py)
        d = self.am.comp(comp)
        h, ox, oy = self.am._host(d)
        self.am.click(h, ox + px, oy + py, button=button, keys=keys)

    def _drag_cells(self, comp, p0, p1, button="left", keys=0, steps=8):
        a = self._cell_px(comp, *p0)
        b = self._cell_px(comp, *p1)
        self._scroll_to(comp, *a)
        d = self.am.comp(comp)
        h, ox, oy = self.am._host(d)
        self.am.drag(h, ox + a[0], oy + a[1], ox + b[0], oy + b[1], button=button, keys=keys, steps=steps)

    def _top(self, screen):
        cls = form_class(screen)
        if not cls:
            return self.am.main
        h = self.am.find_window(cls=cls, timeout=3)
        if not h:
            raise RuntimeError(f"ウィンドウ {cls}（{screen}）がありません")
        return h

    def _current_tab(self):
        return self.am.send(self.am.notebook(), self.amlib.TCM_GETCURSEL)

    # ------------------------------------------------------------------ ops
    def op_openRom(self, step):
        if not self.am.open_rom(str(self.rom)):
            raise RuntimeError(f"ROM を開けません（ステータス: {self.am.status()}）")
        time.sleep(0.5)

    def op_selectMap(self, step):
        if step.get("savePrompt"):
            # 未保存の変更があると AdvanceMap は「変更を保存しますか?」を出す（ZigzaguMap は出さない。仕様上の違い）。
            # その答え（はい / いいえ）を押してから、開き終わるのを待つ
            want = f"{int(step['bank'])}.{int(step['map'])}"
            self.op_selectMap(dict(step, savePrompt=None, noWait=True))
            t0, seen, dbl = time.time(), [], False
            while time.time() - t0 < 8:
                for h in self.am.msgboxes():
                    seen.append(self.am.dialog_info(h).get("texts"))
                    self.am.press(h, step["savePrompt"])
                if not dbl and not seen and time.time() - t0 > 1.0:
                    # Enter が届かないとき（一覧にフォーカスが無いときなど）はダブルクリックで開く
                    tv = self.am.by_name("MapList")
                    its = [i for i in self.am.tv_items(tv) if i["text"].endswith(f"({want})")]
                    if its:
                        self.am.tv_select(tv, its[0]["hitem"], dblclick=True)
                    dbl = True
                st = self.am.status()
                if st and st[0].endswith(want) and "完了" in st[0]:
                    return StepResult("ok", f"保存の確認: {seen}" if seen else "保存の確認は出なかった")
                time.sleep(0.2)
            raise RuntimeError(f"マップ {want} が開きません（ステータス: {self.am.status()}、確認: {seen}）")
        if step.get("noWait"):
            # 確認ダイアログが出る場面用: 開く操作だけして待たない
            tv = self.am.by_name("MapList")
            key = f"({int(step['bank'])}.{int(step['map'])})"
            its = [i for i in self.am.tv_items(tv) if i["text"].endswith(key)]
            if not its:
                raise RuntimeError(f"マップ {key} が一覧にありません")
            self.am.tv_select(tv, its[0]["hitem"])
            self.am.post(tv, self.amlib.WM_KEYDOWN, 0x0D, 1)
            self.am.post(tv, self.amlib.WM_KEYUP, 0x0D, 1 | (3 << 30))
            time.sleep(0.8)
            return
        if not self.am.select_map(int(step["bank"]), int(step["map"])):
            raise RuntimeError(f"マップ {step['bank']}.{step['map']} が開きません（ステータス: {self.am.status()}）")
        time.sleep(0.3)

    def op_selectTab(self, step):
        if not self.am.tab(TAB_NAMES.index(step["tab"])):
            raise RuntimeError(f"タブ {step['tab']} に切り替わりません")

    def op_sortTree(self, step):
        self.am.menu("設定", "マップの表示設定", "ヘッダーのソート", SORT_LABELS[int(step["mode"])])
        time.sleep(1.0)
        self.am.idle(10000)

    def op_selectBlock(self, step):
        b = int(step["block"])
        self._click_cell("BlockPalette", b % 8, b // 8)

    def op_pickPaletteStamp(self, step):
        self._drag_cells("BlockPalette", _xy(step["from"]), _xy(step["to"]), button="right", keys=self.amlib.MK_CONTROL)

    def op_paintBlock(self, step):
        self._click_cell("MapBox", int(step["x"]), int(step["y"]))

    def op_dragPaint(self, step):
        self._drag_cells("MapBox", _xy(step["from"]), _xy(step["to"]), steps=int(step.get("steps", 8)))

    def op_pickBlock(self, step):
        self._click_cell("MapBox", int(step["x"]), int(step["y"]), button="right")

    def op_pickStamp(self, step):
        self._drag_cells("MapBox", _xy(step["from"]), _xy(step["to"]), button="right", keys=self.amlib.MK_CONTROL)

    def op_paintBorder(self, step):
        self._click_cell("RandBox2", int(step["x"]), int(step["y"]))

    def op_pickBorder(self, step):
        self._click_cell("RandBox2", int(step["x"]), int(step["y"]), button="right")

    def op_hover(self, step):
        comp = self.COMP[step.get("target", "map")]
        px, py = self._cell_px(comp, int(step["x"]), int(step["y"]))
        self._scroll_to(comp, px, py)
        h, ox, oy = self.am._host(self.am.comp(comp))
        self.am.post(h, self.amlib.WM_MOUSEMOVE, 0, self.amlib.MAKELPARAM(ox + px, oy + py))
        time.sleep(0.2)
        self.am.idle()

    def op_selectMovement(self, step):
        v = int(step["value"])
        self._click_cell("GehPalette", 0, v)

    def op_paintMovement(self, step):
        self._click_cell("GehBox", int(step["x"]), int(step["y"]))

    def op_dragMovement(self, step):
        self._drag_cells("GehBox", _xy(step["from"]), _xy(step["to"]), steps=int(step.get("steps", 8)))

    def op_pickMovement(self, step):
        self._click_cell("GehBox", int(step["x"]), int(step["y"]), button="right")

    def op_clickEvent(self, step):
        self._click_cell("EventBox", int(step["x"]), int(step["y"]))

    def op_clickComp(self, step):
        top = self._top(step.get("screen"))
        self.am.click_comp(step["comp"], int(step["x"]), int(step["y"]), button=step.get("button", "left"), top=top)
        time.sleep(0.2)
        self.am.idle()

    def op_dragEvent(self, step):
        self._drag_cells("EventBox", _xy(step["from"]), _xy(step["to"]))

    def _menu_path(self, keys):
        """言語ファイルのキーの列 → AdvanceMap（旧言語ファイル）のメニューの文言の列。"""
        lang = self.cfg.lang()
        if not lang:
            raise RuntimeError("言語ファイルが読めないので、メニューのキーを文言にできません（langOld / langNew）")
        from .langmap import menu_norm
        return [menu_norm(lang.old_text(k)) for k in keys]

    def op_menu(self, step):
        if step.get("screen"):
            # 別のフォームのメニュー（ブロックエディタなど）は AdvanceMap の文言の階層で書く
            self.am.menu(*step["path"], hwnd=self._top(step["screen"]))
            time.sleep(float(step.get("wait", 0.5)))
            self.am.idle()
            return
        self.am.menu(*(self._menu_path(step["key"]) if "key" in step else step["path"]))
        time.sleep(float(step.get("wait", 0.5)))
        self.am.idle()

    def op_setField(self, step):
        top = self._top(step.get("screen"))
        d = self.am.comp(step["field"], top=top)
        if d.get("wincls") == "TComboBox":
            self.am.combo(step["field"], select=step["value"], top=top)
        elif d.get("cls") == "TSpinEdit" and str(step["value"]).lstrip("-").isdigit():
            self.am.spin(step["field"], int(step["value"]), top=top)
        elif d.get("cls") in ("TCheckBox", "TRadioButton") or isinstance(step["value"], bool):
            self.am.checkbox(step["field"], bool(step["value"]), top=top)
        else:
            self.am.edit(step["field"], str(step["value"]), top=top)

    def op_clickButton(self, step):
        top = self._top(step.get("screen"))
        self.am.button(step["button"], top=top)

    def _open_dialogs(self, timeout=2.0):
        """メッセージボックスを先に、次に VCL のダイアログ（InputBox など）。出るまで少し待つ。"""
        t0 = time.time()
        while True:
            hs = self.am.msgboxes() + [h for h in self.am.windows()
                                       if h != self.am.main and self._is_dialog(h) and self.amlib.cls_of(h) != "#32770"]
            if hs or time.time() - t0 > timeout:
                return hs
            time.sleep(0.2)

    def op_answerDialog(self, step):
        hs = self._open_dialogs()
        if not hs:
            raise RuntimeError("ダイアログが開いていません")
        if step["button"] == "close":
            # ×で閉じる（手前のもの）
            self.am.post(hs[0], self.amlib.WM_CLOSE)
            time.sleep(1.0)
            self.am.idle()
            return
        if "input" in step:
            # 入力ダイアログ（VCL の InputBox）の入力欄に入れてから押す
            for h in hs:
                eds = [c for c in self.am.flat(h) if c.cls in ("TEdit", "Edit")]
                if eds:
                    self.am.set_text(eds[0].hwnd, str(step["input"]), notify=False)
                    break
        for _ in range(10):
            for h in hs:
                if self.am.press(h, step["button"]):
                    time.sleep(0.4)
                    return
            # 目当てのボタンのあるダイアログが遅れて出ることがある（前のダイアログを閉じた直後など）
            time.sleep(0.2)
            hs = self._open_dialogs(0)
        raise RuntimeError(f"ボタン {step['button']!r} がありません: {[self.am.dialog_info(h) for h in hs]}")

    def op_answerFile(self, step):
        path = step.get("path")
        if path is None:
            hs = self.am.msgboxes()
            if not hs:
                raise RuntimeError("ファイルのダイアログが開いていません")
            self.am.press(hs[-1], "キャンセル") or self.am.post(hs[-1], self.amlib.WM_CLOSE)
            return
        if not self.am.file_dialog(str(self.out / path)):
            raise RuntimeError("ファイルのダイアログが開いていません")
        time.sleep(float(step.get("wait", 1.0)))
        self.am.idle()

    def op_compareFile(self, step):
        p = self.out / step["path"]
        if not p.exists():
            raise RuntimeError(f"ファイルが書かれていません: {p.name}")
        return {"image": str(p)}

    def op_export(self, step):
        self.am.menu("ファイル", "ROMの保存")
        time.sleep(1.5)
        seen = self.am.dismiss_dialogs(button_pref=("OK", "はい"))
        return {"dialogs": seen}

    # ------------------------------------------------------------------ observe
    def _is_dialog(self, h):
        """メッセージボックス（#32770）か VCL のフォーム。IME の表示（UAC_InputIndicator など）や補助の窓は除く。"""
        c = self.amlib.cls_of(h)
        if c == "#32770":
            return True
        return c.startswith("T") and c not in ("TApplication", "TPUtilWindow", "TAMMainForm", "TForm1")

    def dialogs(self):
        out = []
        for h in self.am.windows():
            if h == self.am.main or not self._is_dialog(h):
                continue
            info = self.am.dialog_info(h)
            if self.amlib.cls_of(h) != "#32770" and not info.get("title"):
                continue  # 題名の無い VCL の補助の窓（利用者には見えない）は数えない
            if self.amlib.cls_of(h) != "#32770":
                info["texts"] = [c.text for c in self.am.flat(h) if c.text and c.cls in ("TLabel", "TStaticText", "Static")]
                info["buttons"] = [c.text for c in self.am.flat(h) if c.cls in ("TButton", "TBitBtn", "Button") and c.visible]
            info.pop("hwnd", None)
            # #32770 は Windows 標準のメッセージボックス・ファイルのダイアログ、それ以外は VCL のフォーム（窓）
            info["cls"] = "#32770" if self.amlib.cls_of(h) == "#32770" else "form"
            out.append(info)
        # 列挙は手前から。ZigzaguMap（開いた順。最後が手前）に合わせて奥から並べる
        return out[::-1]

    def op_expectDialog(self, step):
        time.sleep(float(step.get("wait", 0.3)))
        return {"dialogs": self.dialogs()}

    def capture_comp(self, comp: str):
        """部品の全体（スクロールで隠れた部分も）を 1 枚の画像にする。"""
        from PIL import Image
        am, lib = self.am, self.amlib
        d = am.comp(comp)
        W, H = d["width"], d["height"]
        h, _, _ = am._host(d)
        full = Image.new("RGB", (W, H), (255, 0, 255))
        cl, ct, cr, cb = lib.client_rect_of(h)
        # 左上から、見える範囲ずつ取る
        ys = list(range(0, max(H, 1), max(cb, 1))) or [0]
        xs = list(range(0, max(W, 1), max(cr, 1))) or [0]
        for yy in ys:
            for xx in xs:
                if len(ys) > 1 or len(xs) > 1 or d["left"] < 0 or d["top"] < 0:
                    am.send(h, lib.WM_VSCROLL, (yy << 16) | 4, 0)
                    am.send(h, lib.WM_VSCROLL, 8, 0)
                    am.send(h, lib.WM_HSCROLL, (xx << 16) | 4, 0)
                    am.send(h, lib.WM_HSCROLL, 8, 0)
                    time.sleep(0.15)
                    am.idle()
                dd = am.comp(comp)
                hh, ox, oy = am._host(dd)
                top = am.main if not dd.get("top_hwnd") else dd["top_hwnd"]
                img = am.capture(top)
                pt = lib.wt.POINT(0, 0)
                lib.user32.MapWindowPoints(hh, 0, lib.ctypes.byref(pt), 1)
                wl, wtp, _, _ = lib.rect_of(top)
                hx, hy = pt.x - wl, pt.y - wtp  # host のクライアント左上（窓の画像の中）
                vx0, vy0 = max(ox, 0), max(oy, 0)
                vx1, vy1 = min(ox + W, cr), min(oy + H, cb)
                if vx1 <= vx0 or vy1 <= vy0:
                    continue
                part = img.crop((hx + vx0, hy + vy0, hx + vx1, hy + vy1))
                full.paste(part, (vx0 - ox, vy0 - oy))
        # スクロールを左上へ戻す
        if len(ys) > 1 or len(xs) > 1:
            am.send(h, lib.WM_VSCROLL, 6, 0)
            am.send(h, lib.WM_HSCROLL, 6, 0)
            am.send(h, lib.WM_VSCROLL, 8, 0)
            am.idle()
        return full

    def op_snapshot(self, step):
        target = step.get("target", "map")
        if target == "comp":
            self._top(step.get("screen"))  # 窓があることを確かめる
            img = self.capture_comp(step["comp"])
            p = self.out / f"{step['name']}.advancemap.png"
            img.save(p)
            return {"image": str(p)}
        comp = self.COMP[target]
        want_tab = self.TAB_OF[target]
        cur = self._current_tab()
        if target == "blocks" and cur != want_tab:
            self.am.tab(want_tab)
        img = self.capture_comp(comp)
        if target == "blocks" and cur != want_tab:
            self.am.tab(cur)
        name = step["name"]
        p = self.out / f"{name}.advancemap.png"
        img.save(p)
        w = self.out / f"{name}.advancemap.window.png"
        self.am.capture(self.am.main).save(w)
        obs = {"image": str(p), "window": str(w)}
        if (step.get("compare") or {}).get("mode") == "overlayCells":
            # 重ね描きの位置を求めるため、同じ時点のブロックだけの画像も取る
            cur = self._current_tab()
            self.am.tab(0)
            b = self.out / f"{name}.advancemap.base.png"
            self.capture_comp("MapBox").save(b)
            self.am.tab(cur)
            obs["base"] = str(b)
        return obs

    def field(self, fid: str):
        am, lib = self.am, self.amlib
        if fid == "status.left":
            return am.status()[0]
        if fid == "title.map":
            t = lib.text_of(am.main)
            return t.split(" - ", 1)[1] if " - " in t else ""
        if fid == "map.size":
            d = am.comp("MapBox")
            b = am._guess_block("MapBox", d)
            return f"{d['width'] // b}x{d['height'] // b}"
        if fid == "tab":
            return TAB_NAMES[self._current_tab()]
        if fid.startswith("tree."):
            items = am.map_items()
            if fid == "tree.roots":
                return [i["text"] for i in items if i["depth"] == 0]
            if fid == "tree.count":
                return len(items)
            if fid == "tree.first60":
                return [f"{i['depth']}:{i['text']}" for i in items[:60]]
        if fid.startswith("menu.state"):
            am.refresh_menu_states()
            out, gray = {}, set()
            for it in am.menu_items():
                if it["separator"]:
                    continue
                key = "/".join(am._norm(p) for p in it["path"])
                # 灰色のサブメニューの中の項目は押せないので灰色に数える（ZigzaguMap の menu.list と同じ）
                parent_gray = any(key.startswith(g + "/") for g in gray)
                if it["grayed"]:
                    gray.add(key)
                out[key] = ("灰" if it["grayed"] or parent_gray else "") + ("✓" if it["checked"] else "")
            if ":" in fid:
                want = fid.split(":", 1)[1]
                if want.startswith("Menue."):
                    want = "/".join(am._norm(p) for p in self._menu_path(want.split("/")))
                return out.get(want, "(項目なし)")
            return out
        if fid == "romInfo":
            # 左下の ScrollBox_RomInfo の値のラベル（左の見出しは x=8、値は x=120 あたり）を上から
            vals = [d for d in am.vcl_dump() if d.get("parent") == "ScrollBox_RomInfo" and d.get("cls") == "TLabel"
                    and d.get("left", 0) >= 60]
            return [d.get("text", "") for d in sorted(vals, key=lambda d: d.get("top", 0))]
        if fid.startswith("enabled:"):
            # 部品が押せる・入力できるか（灰色でないか）
            d = am.comp(fid.split(":", 1)[1])
            h = d.get("hwnd")
            return bool(d.get("enabled")) and (not h or bool(lib.user32.IsWindowEnabled(h)))
        if fid.startswith("field:"):
            name = fid.split(":", 1)[1]
            d = am.comp(name)
            if d.get("cls") in ("TCheckBox", "TRadioButton"):
                return am.checkbox(name) if d.get("hwnd") else False
            if d.get("cls") == "TScrollBar" and d.get("hwnd"):
                return str(lib.user32.GetScrollPos(d["hwnd"], 2))  # SB_CTL
            if d.get("wincls") == "TComboBox":
                items, sel = am.combo(name)
                return items[sel] if 0 <= sel < len(items) else ""
            return d.get("text", "")
        raise Unsupported(f"知らない欄: {fid}")

    def op_compareFields(self, step):
        vals = {}
        for f in step["fields"]:
            try:
                vals[f] = {"value": self.field(f)}
            except Unsupported as e:
                vals[f] = {"unsupported": str(e)}
            except Exception as e:  # noqa: BLE001
                vals[f] = {"error": f"{type(e).__name__}: {e}"}
        return {"fields": vals}


# ============================================================================ ZigzaguMap
class ZigzaguDriver(Driver):
    name = "zigzagu"
    label = "ZigzaguMap"
    MAPPING = {
        "openRom": "cmd open {rom}",
        "selectMap": "cmd selectMap {bank, map}",
        "selectTab": "cmd tab {name}",
        "sortTree": "cmd action sort.N",
        "selectBlock": "cmd mouse（palette を左クリック。8 個/行）",
        "pickPaletteStamp": "cmd mouse（palette を Ctrl＋右ドラッグ）",
        "paintBlock": "cmd mouse（map を左クリック）",
        "dragPaint": "cmd mouse（map を左ドラッグ。steps 回に分けて動かす）",
        "pickBlock": "cmd mouse（map を右クリック）",
        "pickStamp": "cmd mouse（map を Ctrl＋右ドラッグ）",
        "paintBorder": "cmd mouse（border を左クリック）",
        "pickBorder": "cmd mouse（border を右クリック）",
        "hover": "cmd mouse（hover）",
        "selectMovement": "cmd selectMovement（移動許可のパレットを左クリック）",
        "paintMovement": "cmd mouse（movement を左クリック）",
        "dragMovement": "cmd mouse（movement を左ドラッグ）",
        "pickMovement": "cmd mouse（movement を右クリック）",
        "menu": "cmd menu.run {path}（言語ファイルのキー → 新しい文言の階層。合わなければ zigzagu_menu.json の ID）",
        "setField": "cmd setField {id: field:<部品名>}（別ウィンドウは window）",
        "clickButton": "cmd click {id: field:<部品名>}",
        "clickEvent": "cmd mouse（event を左クリック）",
        "clickComp": "cmd pointer（別ウィンドウ）/ mouse（メイン）で field:<部品名> の中を押す",
        "dragEvent": "cmd mouse（event を左ドラッグ）",
        "answerDialog": "cmd dialog {press}（OK/はい/いいえ/キャンセルは ok/yes/no/cancel）",
        "answerFile": "cmd queuePath {path}（ネイティブのダイアログは開かない）",
        "compareFile": "書かれたファイルを読む",
        "export": "cmd export {dir}",
        "wait": "待つ",
        "snapshot": "cmd canvasPng {target}（blocks は map。palette / border / movementPalette も）",
        "compareFields": "cmd state・status・title・tree.list・menu.list・romInfo・getField・dialogs",
        "expectDialog": "cmd dialogs（メインと別ウィンドウ）と windows",
    }

    def __init__(self, cfg, out_dir, rom: pathlib.Path):
        super().__init__(cfg, out_dir)
        self.rom = rom
        self.proc = None
        self.port = None
        self.movement = 0
        here = pathlib.Path(__file__).resolve().parent.parent
        self.menu_map = json.loads((here / "zigzagu_menu.json").read_text(encoding="utf-8"))

    # ------------------------------------------------------------------ lifecycle
    def _free_port(self):
        lo, hi = self.cfg.ports
        for p in range(lo, hi + 1):
            s = socket.socket()
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
            finally:
                s.close()
        raise RuntimeError(f"ポート {lo}〜{hi} がすべて使用中です")

    def call(self, obj, timeout=120):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/", data=json.dumps(obj).encode("utf-8"), method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            reply = json.loads(r.read().decode("utf-8"))
        if not reply.get("ok"):
            raise AppError(reply.get("error", "不明なエラー"))
        return reply.get("result")

    def start(self):
        exe = self.cfg.zigzaguExe
        if not exe.exists():
            raise SystemExit(f"ZigzaguMap の exe がありません: {exe}（scripts\\build.cmd でビルドしてください）")
        self.port = self._free_port()
        # 個人設定と WebView2 のデータは実行ごとの専用フォルダに置く（通常の利用者の設定には触れない）。
        # WebView2 のデータは実行の間は使い回し（起動を速くするため）、設定はシナリオごとに初期値から始める。
        self.profile = profile_dir(self.out)
        self.profile.mkdir(parents=True, exist_ok=True)
        (self.profile / "settings.json").unlink(missing_ok=True)
        self.proc = subprocess.Popen([str(exe), "--automation", str(self.port), "--profile", str(self.profile)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        last = None
        while time.time() - t0 < 60:
            if self.proc.poll() is not None:
                raise RuntimeError(f"ZigzaguMap がすぐに終了しました（終了コード {self.proc.returncode}）")
            try:
                self.call({"cmd": "state"}, timeout=5)
                if self.cfg.scriptEditorStub:
                    # AdvanceMap の Ini と同じスクリプトエディタ（比較テスト用の代わりの exe、区切りは空白）にする
                    self.call({"cmd": "setting", "key": "scriptEditor", "value": str(self.cfg.scriptEditorStub)})
                    self.call({"cmd": "setting", "key": "scriptSpaceSeparator", "value": True})
                return
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(0.3)
        raise RuntimeError(f"ZigzaguMap の自動操作の入口が応答しません: {last}")

    def stop(self):
        if not self.proc:
            return
        try:
            if self.proc.poll() is None:
                try:
                    self.call({"cmd": "exit"}, timeout=5)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    self.proc.wait(10)
                except subprocess.TimeoutExpired:
                    # 自分が起動したプロセス（とその子の WebView2）だけを終わらせる
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.proc.pid)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    self.proc.wait(10)
        finally:
            self.proc = None

    # ------------------------------------------------------------------ helpers
    def _state(self):
        return self.call({"cmd": "state"})

    def _map(self):
        m = self._state()["map"]
        if not m:
            raise RuntimeError("マップが開かれていません")
        return m

    def _mouse(self, target, action, cell, **kw):
        req = {"cmd": "mouse", "target": target, "action": action, "cell": [int(cell[0]), int(cell[1])]}
        req.update({k: v for k, v in kw.items() if v is not None})
        return self.call(req)

    def _drag(self, target, step, button="left", ctrl=False):
        a, b = _xy(step["from"]), _xy(step["to"])
        return self._mouse(target, "drag", a, to=[b[0], b[1]], button=button, ctrl=ctrl or None,
                           steps=int(step.get("steps", 8)))

    @staticmethod
    def _window_of(screen):
        """シナリオの screen（AdvanceMap のフォームのクラス名）→ ZigzaguMap のウィンドウのラベル（メインなら None）。"""
        return zigzagu_window(screen)

    def _field_req(self, screen, name):
        win = self._window_of(screen)
        req = {"id": name if win == "world-map" else f"field:{name}"}
        if win:
            req["window"] = win
        return req

    def _windows(self):
        try:
            return [w["label"] for w in self.call({"cmd": "windows"}) if w.get("ready")]
        except Exception:  # noqa: BLE001
            return ["main"]

    def _all_dialogs(self):
        """開いているダイアログ（メインと別ウィンドウ）と、メイン以外のウィンドウ。AdvanceMap の dialogs() と同じ形にする。"""
        # 別ウィンドウ（AdvanceMap の VCL のフォームに当たる）を先に、ダイアログを後に（開いた順）
        out = [{"title": w.get("title", ""), "texts": [], "buttons": [], "cls": "window"}
               for w in self.call({"cmd": "windows"}) if w["label"] != "main" and w.get("visible")]
        for w in self._windows():
            req = {"cmd": "dialogs"} if w == "main" else {"cmd": "dialogs", "window": w}
            try:
                ds = self.call(req)["dialogs"]
            except Exception:  # noqa: BLE001
                ds = []
            for d in ds:
                out.append({"title": d.get("title", ""), "texts": [d["text"]] if d.get("text") else [],
                            "buttons": list(d.get("buttons", [])), "cls": "app" if d.get("kind") == "app" else "native"})
        return out

    BUTTON_ROLES = {"close": "close", "ok": "ok", "はい": "yes", "yes": "yes", "いいえ": "no", "no": "no", "キャンセル": "cancel", "cancel": "cancel"}

    def _press_dialog(self, button, text=None):
        role = self.BUTTON_ROLES.get(button.replace("&", "").split("(")[0].strip().lower())
        for w in self._windows():
            base = {"cmd": "dialogs"} if w == "main" else {"cmd": "dialogs", "window": w}
            try:
                if not self.call(base)["dialogs"]:
                    continue
            except AppError:
                continue
            req = {"cmd": "dialog", "press": role or button}
            if text is not None:
                req["input"] = str(text)
            if w != "main":
                req["window"] = w
            try:
                return self.call(req)
            except AppError:
                if not role:
                    raise
                req["press"] = button  # 役割で押せなければ文字列で
                return self.call(req)
        if role == "close":
            # ダイアログが無ければ、手前の別ウィンドウ（ブロックエディタなど）を × で閉じる
            time.sleep(0.5)  # 自分で閉じる途中のウィンドウ（一括変更の保存のあとなど）を数えない
            wins = [w["label"] for w in self.call({"cmd": "windows"}) if w["label"] != "main" and w.get("visible") and w.get("ready")]
            if wins:
                try:
                    self.call({"cmd": "close", "window": wins[-1]}, timeout=10)
                except (TimeoutError, OSError):
                    pass  # 閉じたウィンドウからは返事が来ないことがある
                time.sleep(0.5)
                return None
        raise RuntimeError("ダイアログが開いていません")

    def _menu_path(self, keys):
        lang = self.cfg.lang()
        if not lang:
            return None
        from .langmap import menu_norm
        return [menu_norm(lang.new_text(k)) for k in keys]

    # ------------------------------------------------------------------ ops
    def op_openRom(self, step):
        self.call({"cmd": "open", "rom": str(self.rom)})

    def op_selectMap(self, step):
        self.call({"cmd": "selectMap", "bank": int(step["bank"]), "map": int(step["map"])})

    def op_selectTab(self, step):
        self.call({"cmd": "tab", "name": step["tab"]})

    def op_sortTree(self, step):
        self.call({"cmd": "action", "id": f"sort.{int(step['mode'])}"})

    def op_selectBlock(self, step):
        b = int(step["block"])
        self._mouse("palette", "click", (b % 8, b // 8))

    def op_pickPaletteStamp(self, step):
        self._drag("palette", step, button="right", ctrl=True)

    def op_paintBlock(self, step):
        self._mouse("map", "click", (step["x"], step["y"]))

    def op_dragPaint(self, step):
        self._drag("map", step)

    def op_pickBlock(self, step):
        self._mouse("map", "rightClick", (step["x"], step["y"]))

    def op_pickStamp(self, step):
        self._drag("map", step, button="right", ctrl=True)

    def op_paintBorder(self, step):
        self._mouse("border", "click", (step["x"], step["y"]))

    def op_pickBorder(self, step):
        self._mouse("border", "rightClick", (step["x"], step["y"]))

    def op_hover(self, step):
        self._mouse(step.get("target", "map"), "hover", (step["x"], step["y"]))

    def op_selectMovement(self, step):
        self.call({"cmd": "selectMovement", "value": int(step["value"])})

    def op_paintMovement(self, step):
        self._mouse("movement", "click", (step["x"], step["y"]))

    def op_dragMovement(self, step):
        self._drag("movement", step)

    def op_pickMovement(self, step):
        self._mouse("movement", "rightClick", (step["x"], step["y"]))

    def op_clickEvent(self, step):
        self._mouse("event", "click", (step["x"], step["y"]))

    def op_clickComp(self, step):
        win = self._window_of(step.get("screen"))
        x, y = int(step["x"]), int(step["y"])
        right = step.get("button") == "right"
        if not win:
            self.call({"cmd": "mouse", "id": f"field:{step['comp']}", "px": [x, y], "action": "rightClick" if right else "click"})
            return
        cid = step["comp"] if win == "world-map" else f"field:{step['comp']}"
        if not step["comp"].endswith("Box"):
            # Canvas でない部品（パレットエディタの色の見本など）はクリックの出来事で押す
            self.call({"cmd": "click", "window": win, "id": cid})
            return
        for t in ("move", "down", "up"):
            self.call({"cmd": "pointer", "window": win, "id": cid, "type": t, "x": x, "y": y,
                       "button": 2 if right else 0})

    def op_dragEvent(self, step):
        self._drag("event", step)

    def op_menu(self, step):
        win = self._window_of(step.get("screen"))
        if step.get("screen"):
            # 別ウィンドウのメニューはアクション ID（シナリオの zigzagu）で実行する
            req = {"cmd": "action", "id": step["zigzagu"]}
            if win:
                req["window"] = win
            self.call(req)
            time.sleep(float(step.get("wait", 0.3)))
            return
        keys = step.get("key")
        path = self._menu_path(keys) if keys else step.get("path")
        ent = self.menu_map.get(" > ".join(keys or step.get("path", [])))
        try:
            if not path:
                raise AppError("階層が分かりません")
            self.call({"cmd": "menu.run", "path": path})
        except AppError as e:
            if ent is None or "無効な項目" in str(e):
                raise
            # 文言が言語ファイルと違う項目は、アクション ID の対応表（zigzagu_menu.json）で実行する
            self.call({"cmd": "menu.run", "id": ent["id"] if isinstance(ent, dict) else ent})
        time.sleep(float(step.get("wait", 0.3)))

    def op_setField(self, step):
        value = step["value"]
        if self._window_of(step.get("screen")) == "world-map" and isinstance(value, int) and not isinstance(value, bool)                 and not step["field"].startswith("Cbo_"):
            value = str(value)  # ワールドマップエディタの入力欄は文字列で入れる
        self.call({"cmd": "setField", "value": value, **self._field_req(step.get("screen"), step["field"])})

    def op_clickButton(self, step):
        self.call({"cmd": "click", **self._field_req(step.get("screen"), step["button"])})

    def op_answerDialog(self, step):
        self._press_dialog(step["button"], step.get("input"))
        time.sleep(0.2)

    def op_expectDialog(self, step):
        time.sleep(float(step.get("wait", 0.3)))
        return {"dialogs": self._all_dialogs()}

    def op_answerFile(self, step):
        path = step.get("path")
        value = None if path is None else str(self.out / path)
        # ファイルのダイアログが開いているウィンドウへ答える（無ければ screen のウィンドウ、それも無ければメインに積む）
        target = None
        for w in self._windows():
            req = {"cmd": "dialogs"} if w == "main" else {"cmd": "dialogs", "window": w}
            try:
                if any(d.get("kind") == "native" for d in self.call(req)["dialogs"]):
                    target = w
            except AppError:
                pass
        target = target or self._window_of(step.get("screen")) or "main"
        req = {"cmd": "queuePath", "path": value}
        if target != "main":
            req["window"] = target
        self.call(req)
        time.sleep(float(step.get("wait", 0.8)))

    def op_compareFile(self, step):
        p = self.out / step["path"]
        t0 = time.time()
        while not p.exists() and time.time() - t0 < 5:
            time.sleep(0.2)
        if not p.exists():
            raise RuntimeError(f"ファイルが書かれていません: {p.name}")
        return {"image": str(p)}

    def op_export(self, step):
        d = self.out / "export"
        d.mkdir(parents=True, exist_ok=True)
        return {"export": self.call({"cmd": "export", "dir": str(d)})}

    SNAP_TARGETS = {"map": "map", "movement": "movement", "event": "event", "blocks": "map", "palette": "palette",
                    "border": "border", "movementPalette": "movementPalette"}

    def op_snapshot(self, step):
        target = step.get("target", "map")
        if target == "comp":
            win = self._window_of(step.get("screen"))
            req = {"cmd": "canvasPng", "id": step["comp"] if win == "world-map" else f"field:{step['comp']}"}
            if win:
                req["window"] = win
            p = self.out / f"{step['name']}.zigzagu.png"
            p.write_bytes(base64.b64decode(self.call(req)["png"]))
            return {"image": str(p)}
        if target not in self.SNAP_TARGETS:
            raise Unsupported(f"画像 {target} を取る命令がありません")
        r = self.call({"cmd": "canvasPng", "target": self.SNAP_TARGETS[target]})
        name = step["name"]
        p = self.out / f"{name}.zigzagu.png"
        p.write_bytes(base64.b64decode(r["png"]))
        base = None
        if (step.get("compare") or {}).get("mode") == "overlayCells":
            base = self.out / f"{name}.zigzagu.base.png"
            base.write_bytes(base64.b64decode(self.call({"cmd": "canvasPng", "target": "map"})["png"]))
        w = self.out / f"{name}.zigzagu.window.png"
        try:
            s = self.call({"cmd": "screenshot"})
            w.write_bytes(base64.b64decode(s["png"]))
        except Exception:  # noqa: BLE001
            w = None
        obs = {"image": str(p), "window": str(w) if w else None}
        if base:
            obs["base"] = str(base)
        return obs

    def _menu_state(self):
        from .langmap import menu_norm
        out = {}
        for it in self.call({"cmd": "menu.list"}):
            key = "/".join(menu_norm(p) for p in it["path"])
            out[key] = ("" if it["enabled"] else "灰") + ("✓" if it["checked"] else "")
        return out

    def field(self, fid, st):
        if fid == "status.left":
            return self.call({"cmd": "status"})["left"]
        if fid == "title.map":
            t = self.call({"cmd": "title"})["window"]
            return t.split(" - ", 1)[1] if " - " in t else ""
        if fid == "map.size":
            m = st["map"]
            return f"{m['width']}x{m['height']}" if m else ""
        if fid == "tab":
            return st["tab"]
        if fid.startswith("tree."):
            items = self.call({"cmd": "tree.list"})
            if fid == "tree.roots":
                return [i["text"] for i in items if i["depth"] == 0]
            if fid == "tree.count":
                return len(items)
            if fid == "tree.first60":
                return [f"{i['depth']}:{i['text']}" for i in items[:60]]
        if fid.startswith("menu.state"):
            out = self._menu_state()
            if ":" in fid:
                want = fid.split(":", 1)[1]
                if want.startswith("Menue."):
                    want = "/".join(self._menu_path(want.split("/")) or [])
                return out.get(want, "(項目なし)")
            return out
        if fid == "romInfo":
            return [r["value"] for r in self.call({"cmd": "romInfo"})]
        if fid == "dialogs":
            return self._all_dialogs()
        if fid.startswith(("field:", "enabled:")):
            kind, name = fid.split(":", 1)
            last = None
            # 別ウィンドウ（後から開いたもの）を先に探す（ワールドマップエディタの Txt_PosX とイベントの Txt_PosX など、
            # 同じ名前の部品がメインにもある）。compareFields に screen があればそのウィンドウを最初に
            wins = [w for w in self._windows() if w != "main"][::-1] + ["main"]
            first = self._window_of(st.get("_screen")) if isinstance(st, dict) and st.get("_screen") else None
            if first in wins:
                wins.remove(first)
                wins.insert(0, first)
            for w in wins:
                req = {"cmd": "getField", "id": f"field:{name}" if w != "world-map" else name}
                if w != "main":
                    req["window"] = w
                try:
                    r = self.call(req)
                    if kind == "enabled":
                        return bool(r.get("enabled"))
                    # ワールドマップエディタの部品は value / checked / text のどれかで返る
                    return r["value"] if "value" in r else r["checked"] if "checked" in r else r.get("text", "")
                except AppError as e:
                    last = e
            raise Unsupported(f"欄 {name} に当たる部品がありません（{last}）")
        raise Unsupported(f"欄 {fid} を読む命令がありません")

    def op_compareFields(self, step):
        st = dict(self._state(), _screen=step.get("screen"))
        vals = {}
        for f in step["fields"]:
            try:
                vals[f] = {"value": self.field(f, st)}
            except Unsupported as e:
                vals[f] = {"unsupported": str(e)}
            except AppError as e:
                vals[f] = {"unsupported": f"ZigzaguMap がエラーを返した: {e}"}
        return {"fields": vals}


def profile_dir(out_dir: pathlib.Path) -> pathlib.Path:
    """ZigzaguMap のプロファイル（--profile）の置き場所。結果フォルダ（<日時>/<シナリオ>/zigzagu）の 2 つ上に作る。"""
    return out_dir.parent.parent / "_zigzagu-profile"


class AppError(Exception):
    """ZigzaguMap が {"ok": false} を返した。"""
