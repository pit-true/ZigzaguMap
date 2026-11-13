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
        "dragEvent": "EventBox を左ドラッグ",
        "answerDialog": "ダイアログのボタンに BM_CLICK",
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
        if not screen or screen == "main":
            return self.am.main
        h = self.am.find_window(title=screen, timeout=3)
        if not h:
            raise RuntimeError(f"ウィンドウ {screen!r} がありません")
        return h

    def _current_tab(self):
        return self.am.send(self.am.notebook(), self.amlib.TCM_GETCURSEL)

    # ------------------------------------------------------------------ ops
    def op_openRom(self, step):
        if not self.am.open_rom(str(self.rom)):
            raise RuntimeError(f"ROM を開けません（ステータス: {self.am.status()}）")
        time.sleep(0.5)

    def op_selectMap(self, step):
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

    def op_dragEvent(self, step):
        self._drag_cells("EventBox", _xy(step["from"]), _xy(step["to"]))

    def op_menu(self, step):
        self.am.menu(*step["path"])
        time.sleep(float(step.get("wait", 0.5)))
        self.am.idle()

    def op_setField(self, step):
        top = self._top(step.get("screen"))
        d = self.am.comp(step["field"], top=top)
        if d.get("wincls") == "TComboBox":
            self.am.combo(step["field"], select=step["value"], top=top)
        else:
            self.am.edit(step["field"], str(step["value"]), top=top)

    def op_clickButton(self, step):
        top = self._top(step.get("screen"))
        self.am.button(step["button"], top=top)

    def op_answerDialog(self, step):
        hs = self.am.msgboxes() or [h for h in self.am.windows() if h != self.am.main and self._is_dialog(h)]
        if not hs:
            raise RuntimeError("ダイアログが開いていません")
        if not self.am.press(hs[0], step["button"]):
            raise RuntimeError(f"ボタン {step['button']!r} がありません: {self.am.dialog_info(hs[0])}")
        time.sleep(0.4)

    def op_export(self, step):
        self.am.menu("ファイル", "ROMの保存")
        time.sleep(1.5)
        seen = self.am.dismiss_dialogs(button_pref=("OK", "はい"))
        return {"dialogs": seen}

    # ------------------------------------------------------------------ observe
    def _is_dialog(self, h):
        c = self.amlib.cls_of(h)
        return c not in ("TApplication", "tooltips_class32", "TPUtilWindow", "#32768", "TAMMainForm", "TForm1")

    def dialogs(self):
        out = []
        for h in self.am.windows():
            if h == self.am.main or not self._is_dialog(h):
                continue
            info = self.am.dialog_info(h)
            if self.amlib.cls_of(h) != "#32770":
                info["texts"] = [c.text for c in self.am.flat(h) if c.text and c.cls in ("TLabel", "TStaticText", "Static")]
                info["buttons"] = [c.text for c in self.am.flat(h) if c.cls in ("TButton", "TBitBtn", "Button") and c.visible]
            info.pop("hwnd", None)
            out.append(info)
        return out

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
            out = {}
            for it in am.menu_items():
                if it["separator"]:
                    continue
                key = "/".join(am._norm(p) for p in it["path"])
                out[key] = ("灰" if it["grayed"] else "") + ("✓" if it["checked"] else "")
            if ":" in fid:
                return out.get(fid.split(":", 1)[1], "(項目なし)")
            return out
        if fid == "romInfo":
            return [d.get("text", "") for d in am.vcl_dump() if d.get("parent") == "GroupBox1" and d.get("cls") == "TLabel"]
        if fid.startswith("field:"):
            name = fid.split(":", 1)[1]
            d = am.comp(name)
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
        "selectBlock": "cmd selectBlock {block}（パレットのクリックは無いので選択の値を直接変える＝代用）",
        "pickPaletteStamp": "cmd selectBlock {blocks, width}（パレットの番号から計算＝代用）",
        "paintBlock": "cmd command paintBlocks（選択中のブロックを置く＝代用）",
        "dragPaint": "cmd command paintBlocks（ドラッグで通るマスを計算して 1 回で置く＝代用）",
        "pickBlock": "cmd cells で読んで selectBlock（代用）",
        "pickStamp": "cmd cells で読んで selectBlock {blocks, width}（代用）",
        "paintBorder": "cmd command paintBorder（代用）",
        "pickBorder": "cmd cells の border を読んで selectBlock（代用）",
        "hover": None,
        "selectMovement": "ドライバー側で値を覚える（移動許可の選択を変える命令が無い＝代用）",
        "paintMovement": "cmd command paintMovement（代用）",
        "dragMovement": "cmd command paintMovement（通るマスを計算＝代用）",
        "pickMovement": "cmd cells で読んで値を覚える（代用）",
        "menu": "cmd action {id}（メニューの文言 → アクション ID の対応表 zigzagu_menu.json）",
        "setField": None,
        "clickButton": None,
        "clickEvent": None,
        "dragEvent": None,
        "answerDialog": None,
        "export": "cmd export {dir}",
        "wait": "待つ",
        "snapshot": "cmd canvasPng {tab}（blocks は map タブの Canvas）",
        "compareFields": "cmd state（status.left / title.map / map.size / tab）",
        "expectDialog": None,
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
        self.proc = subprocess.Popen([str(exe), "--automation", str(self.port)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        last = None
        while time.time() - t0 < 60:
            if self.proc.poll() is not None:
                raise RuntimeError(f"ZigzaguMap がすぐに終了しました（終了コード {self.proc.returncode}）")
            try:
                self.call({"cmd": "state"}, timeout=5)
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

    def _cells(self):
        return self.call({"cmd": "cells"})

    def _paint(self, cells_xy):
        """選択中のブロック（スタンプ）を、各マスを左上にして置く。"""
        st = self._state()
        m, sel = st["map"], st["selection"]
        if not m:
            raise RuntimeError("マップが開かれていません")
        w, h, blocks = sel["width"], sel["height"], sel["blocks"]
        cells = {}
        for (x, y) in cells_xy:
            for dy in range(h):
                for dx in range(w):
                    cx, cy = x + dx, y + dy
                    if 0 <= cx < m["width"] and 0 <= cy < m["height"]:
                        cells[(cx, cy)] = blocks[dy * w + dx]
        self.call({"cmd": "command", "name": "paintBlocks",
                   "args": {"bank": m["bank"], "map": m["map"],
                            "cells": [{"x": x, "y": y, "block": b} for (x, y), b in cells.items()]}})

    def _emu(self, note):
        return StepResult("emulated", note)

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
        self.call({"cmd": "selectBlock", "block": int(step["block"])})
        return self._emu("パレットのクリックの代わりに selectBlock")

    def op_pickPaletteStamp(self, step):
        (x0, y0), (x1, y1) = _xy(step["from"]), _xy(step["to"])
        xa, xb, ya, yb = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
        blocks = [y * 8 + x for y in range(ya, yb + 1) for x in range(xa, xb + 1)]
        self.call({"cmd": "selectBlock", "blocks": blocks, "width": xb - xa + 1})
        return self._emu("パレットの Ctrl＋右ドラッグの代わりに selectBlock")

    def op_paintBlock(self, step):
        self._paint([(int(step["x"]), int(step["y"]))])
        return self._emu("左クリックの代わりに paintBlocks")

    def op_dragPaint(self, step):
        st = self._state()
        sel = st["selection"]
        cells = drag_cells(_xy(step["from"]), _xy(step["to"]), int(step.get("steps", 8)))
        if sel["width"] * sel["height"] > 1:
            cells = cells[:1]  # スタンプはドラッグしても 1 回だけ置く（README）
        self._paint(cells)
        return self._emu("左ドラッグの代わりに、通るマスを paintBlocks")

    def op_pickBlock(self, step):
        c = self._cells()
        v = c["cells"][int(step["y"]) * c["width"] + int(step["x"])]
        self.call({"cmd": "selectBlock", "block": v & 0x3FF})
        return self._emu("右クリックの代わりに cells → selectBlock")

    def op_pickStamp(self, step):
        c = self._cells()
        (x0, y0), (x1, y1) = _xy(step["from"]), _xy(step["to"])
        xa, xb, ya, yb = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
        blocks = [c["cells"][y * c["width"] + x] & 0x3FF for y in range(ya, yb + 1) for x in range(xa, xb + 1)]
        self.call({"cmd": "selectBlock", "blocks": blocks, "width": xb - xa + 1})
        return self._emu("Ctrl＋右ドラッグの代わりに cells → selectBlock")

    def op_paintBorder(self, step):
        st = self._state()
        m, sel = st["map"], st["selection"]
        self.call({"cmd": "command", "name": "paintBorder",
                   "args": {"bank": m["bank"], "map": m["map"],
                            "cells": [{"x": int(step["x"]), "y": int(step["y"]), "block": sel["blocks"][0]}]}})
        return self._emu("境界ブロックのクリックの代わりに paintBorder")

    def op_pickBorder(self, step):
        c = self._cells()
        v = c["border"][int(step["y"]) * 2 + int(step["x"])]
        self.call({"cmd": "selectBlock", "block": v & 0x3FF})
        return self._emu("境界ブロックの右クリックの代わりに cells → selectBlock")

    def op_selectMovement(self, step):
        self.movement = int(step["value"])
        return self._emu("移動許可の選択はドライバー側で覚える")

    def _paint_movement(self, cells_xy):
        m = self._map()
        self.call({"cmd": "command", "name": "paintMovement",
                   "args": {"bank": m["bank"], "map": m["map"],
                            "cells": [{"x": x, "y": y, "movement": self.movement} for x, y in cells_xy]}})

    def op_paintMovement(self, step):
        self._paint_movement([(int(step["x"]), int(step["y"]))])
        return self._emu("左クリックの代わりに paintMovement")

    def op_dragMovement(self, step):
        self._paint_movement(drag_cells(_xy(step["from"]), _xy(step["to"]), int(step.get("steps", 8))))
        return self._emu("左ドラッグの代わりに、通るマスを paintMovement")

    def op_pickMovement(self, step):
        c = self._cells()
        self.movement = c["cells"][int(step["y"]) * c["width"] + int(step["x"])] >> 10
        return self._emu("右クリックの代わりに cells で読んだ値を覚える")

    def op_menu(self, step):
        key = " > ".join(step["path"])
        ent = self.menu_map.get(key)
        if ent is None:
            raise Unsupported(f"メニュー {key} の対応がありません（zigzagu_menu.json）")
        if isinstance(ent, dict):
            if ent.get("dialog"):
                raise Unsupported(f"メニュー {key} はダイアログを開くが、自動操作の入口からダイアログを扱えない")
            ent = ent["id"]
        self.call({"cmd": "action", "id": ent})
        time.sleep(float(step.get("wait", 0.3)))

    def op_export(self, step):
        d = self.out / "export"
        d.mkdir(parents=True, exist_ok=True)
        return {"export": self.call({"cmd": "export", "dir": str(d)})}

    def op_snapshot(self, step):
        target = step.get("target", "map")
        tab = {"map": None, "movement": None, "event": None, "blocks": "map"}.get(target, "?")
        if tab == "?":
            raise Unsupported(f"画像 {target} を取る命令がありません（canvasPng は map / movement / event だけ）")
        req = {"cmd": "canvasPng"}
        if tab:
            req["tab"] = tab
        elif target in ("movement", "event"):
            req["tab"] = target
        r = self.call(req)
        name = step["name"]
        p = self.out / f"{name}.zigzagu.png"
        p.write_bytes(base64.b64decode(r["png"]))
        base = None
        if (step.get("compare") or {}).get("mode") == "overlayCells":
            base = self.out / f"{name}.zigzagu.base.png"
            base.write_bytes(base64.b64decode(self.call({"cmd": "canvasPng", "tab": "map"})["png"]))
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

    def field(self, fid, st):
        if fid == "status.left":
            return st["status"]["left"]
        if fid == "title.map":
            t = st["title"]
            return t.split(" - ", 1)[1] if " - " in t else ""
        if fid == "map.size":
            m = st["map"]
            return f"{m['width']}x{m['height']}" if m else ""
        if fid == "tab":
            return st["tab"]
        raise Unsupported(f"欄 {fid} を読む命令がありません")

    def op_compareFields(self, step):
        st = self._state()
        vals = {}
        for f in step["fields"]:
            try:
                vals[f] = {"value": self.field(f, st)}
            except Unsupported as e:
                vals[f] = {"unsupported": str(e)}
        return {"fields": vals}


class AppError(Exception):
    """ZigzaguMap が {"ok": false} を返した。"""
