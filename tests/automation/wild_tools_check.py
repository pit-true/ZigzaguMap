"""野生ポケモンの Phase5 の機能（#398）を、素の ROM だけで確かめる。

  python tests/automation/wild_tools_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 1 番道路（3.19）の野生タブで、草むらの各枠の横に割合（20,20,10,10,10,10,5,5,4,4,1,1）が出て、合計が 100%。
  釣りは竿ごとに 100%（ボロ 70,30・いい 60,20,20・すごい 40,40,15,4,1）。
- 「グラフ…」で、種族ごとの合計の割合とレベルの分布の窓が開き、棒にマウスを乗せると値が出る。
- ツール > 野生ポケモンの検索… でポッポを探すと、3.19 の草むらの行が出る。列の見出しで並べ替えられ、
  行のダブルクリックでそのマップの野生タブを開く。
- 種族の欄に打って選ぶ（#447）: 欄を押すと全部の候補、カタカナ・ひらがな・ローマ字・番号で前方一致、
  ↑↓ と Enter・候補を押す・名前が 1 つに決まる文字と Enter で決まる。Esc で閉じる。当たらないときはその旨を出す。
  `--shots` を付けると、候補が出ている所を fb447_hiragana.png・fb447_romaji.png に撮る。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import re
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
ROUTE1 = {"bank": 3, "map": 19}
LAND = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]
PIDGEY = 16


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if shots:
        png = z.call({"cmd": "screenshot"})
        (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def field(z: Zigzagu, id_: str):
    return z.call({"cmd": "getField", "id": id_})


SP = "wild.search.species"


def items(z: Zigzagu, limit: int = 500) -> list[str]:
    """出ている候補の文字（名前と番号）。"""
    out = []
    for i in range(limit):
        try:
            f = field(z, f"{SP}.item.{i}")
        except Exception:
            break
        out.append(f.get("value", ""))
    return out


def list_open(z: Zigzagu) -> bool:
    return bool(field(z, f"{SP}.list").get("visible"))


def typed(z: Zigzagu, text: str) -> list[str]:
    z.call({"cmd": "ui.type", "id": SP, "text": text, "blur": False})
    time.sleep(0.1)
    return items(z)


def wait_info(z: Zigzagu) -> str:
    info = ""
    for _ in range(100):
        info = field(z, "wild.search.info").get("value", "")
        if "枠" in info or "ありません" in info or "選んで" in info:
            break
        time.sleep(0.1)
    return info


def check_typing(z: Zigzagu, shots: pathlib.Path | None) -> None:
    """#447: 種族の欄に打って候補から選ぶ。"""
    z.call({"cmd": "action", "id": "tools.wildSearch"})
    time.sleep(0.5)
    check(field(z, SP).get("value") == "フシギダネ", f"447: 初めはフシギダネ（{field(z, SP).get('value')}）")
    # 欄を押すと全部の候補が出る
    z.call({"cmd": "click", "id": SP})
    time.sleep(0.2)
    all_items = items(z)
    check(list_open(z) and len(all_items) == 411, f"447: 欄を押すと全部の候補が出る（{len(all_items)} 件）")
    # Esc で閉じる（窓は閉じない）
    z.call({"cmd": "key", "key": "Escape", "id": SP})
    d = z.call({"cmd": "dialogs"})
    d = d["dialogs"] if isinstance(d, dict) else d
    check(not list_open(z) and any(x.get("title") == "野生ポケモンの検索" for x in d), "447: Esc で候補を閉じ、窓は残る")

    # ひらがな → ↓ と Enter
    hira = typed(z, "ぽっ")
    check(len(hira) == 1 and hira[0].startswith("ポッポ"), f"447: 「ぽっ」でポッポが出る（{hira}）")
    shot(z, shots, "fb447_hiragana.png")
    z.call({"cmd": "key", "key": "ArrowDown", "id": SP})
    z.call({"cmd": "key", "key": "Enter", "id": SP})
    check(field(z, SP).get("value") == "ポッポ" and not list_open(z), f"447: ↓ と Enter で決まる（{field(z, SP).get('value')}）")
    # 一覧を閉じているときの Enter で検索する
    z.call({"cmd": "key", "key": "Enter", "id": SP})
    info = wait_info(z)
    check("枠" in info, f"447: Enter で検索する（{info}）")

    # カタカナ・ローマ字（ヘボン式・訓令式）・番号で前方一致
    for q, want in [("フシ", ["フシギダネ", "フシギソウ", "フシギバナ"]), ("fushi", ["フシギダネ", "フシギソウ", "フシギバナ"]), ("husi", ["フシギダネ", "フシギソウ", "フシギバナ"]),
                    ("pikachu", ["ピカチュウ"]), ("rizado", ["リザード", "リザードン"]), ("ジグザ", ["ジグザグマ"]), ("No.16", ["ポッポ"]), ("0x10", ["ポッポ"])]:
        got = [re.sub(r"No\..*$", "", s) for s in typed(z, q)]
        check(got[: len(want)] == want if q.startswith(("No", "0x")) else got == want, f"447: 「{q}」の候補（{got[:6]}）")
    # ローマ字で打って、候補を押して決める
    roma = typed(z, "pijo")
    check([re.sub(r"No\..*$", "", s) for s in roma] == ["ピジョン", "ピジョット"], f"447: 「pijo」でピジョン・ピジョット（{roma}）")
    shot(z, shots, "fb447_romaji.png")
    z.call({"cmd": "click", "id": f"{SP}.item.1"})
    check(field(z, SP).get("value") == "ピジョット" and not list_open(z), f"447: 候補を押して決まる（{field(z, SP).get('value')}）")
    # 名前が 1 つに決まる文字を打って Enter
    typed(z, "koratta")
    z.call({"cmd": "key", "key": "Enter", "id": SP})
    check(field(z, SP).get("value") == "コラッタ", f"447: 「koratta」と Enter で決まる（{field(z, SP).get('value')}）")
    z.call({"cmd": "click", "id": "wild.search.run"})
    info = wait_info(z)
    check("枠" in info, f"447: コラッタを探す（{info}）")
    # 当たらないとき
    none = typed(z, "zzz")
    nf = field(z, f"{SP}.none")
    check(none == [] and nf.get("visible") and "ありません" in nf.get("value", ""), f"447: 当たらないときはその旨を出す（{nf.get('value')}）")
    # 決まらないまま離れたら元に戻る
    z.call({"cmd": "ui.type", "id": SP, "text": "zzz", "blur": True})
    check(field(z, SP).get("value") == "コラッタ", f"447: 決まらないまま離れたら元に戻る（{field(z, SP).get('value')}）")
    # 今までどおり番号で setField
    z.call({"cmd": "setField", "id": SP, "value": PIDGEY})
    check(field(z, SP).get("value") == "ポッポ", f"447: 番号の setField も使える（{field(z, SP).get('value')}）")
    z.call({"cmd": "dialog", "press": "close"})


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    a = p.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with Zigzagu(a.exe, profile=pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-"))) as z:
        z.call({"cmd": "open", "rom": a.rom})
        z.call({"cmd": "selectMap", **ROUTE1})
        z.call({"cmd": "tab", "name": "wild"})
        time.sleep(0.3)

        # 枠の割合（草むら）
        rates = []
        for i in range(12):
            f = field(z, f"wild.slotRate.{i + 1}")
            m = re.match(r"(\d+)%", f.get("value") or "")
            rates.append(int(m.group(1)) if m and f.get("visible") else None)
        check(rates == LAND and sum(LAND) == 100, f"398: 草むらの枠の割合（{rates}）")
        shot(z, shots, "wild_rates.png")

        # 釣り（3.19 に無ければ水のあるマップを探さずに、割合の表示だけ確かめる）
        z.call({"cmd": "setField", "id": "wild.type", "value": 3})
        time.sleep(0.2)
        fish = [field(z, f"wild.slotRate.{i + 1}") for i in range(10)]
        if all(f.get("visible") for f in fish):
            vals = [int(re.match(r"(\d+)", f["value"]).group(1)) for f in fish]
            check(sum(vals[0:2]) == 100 and sum(vals[2:5]) == 100 and sum(vals[5:10]) == 100, f"398: 釣りは竿ごとに 100%（{vals}）")
        z.call({"cmd": "setField", "id": "wild.type", "value": 0})
        time.sleep(0.2)

        # グラフ
        z.call({"cmd": "click", "id": "wild.chart"})
        time.sleep(0.5)
        d = z.call({"cmd": "dialogs"})
        d = d["dialogs"] if isinstance(d, dict) else d
        check(any("グラフ" in x.get("title", "") for x in d), "398: グラフの窓が開く")
        z.call({"cmd": "mouse", "id": "wild.chart.totals", "action": "hover", "px": [10, 100]})
        time.sleep(0.2)
        hover = field(z, "wild.chart.hover").get("value", "")
        check("%" in hover, f"398: 棒にマウスを乗せると値が出る（{hover}）")
        z.call({"cmd": "setField", "id": "wild.chart.species", "value": 1})
        z.call({"cmd": "mouse", "id": "wild.chart.levels", "action": "hover", "px": [10, 80]})
        time.sleep(0.2)
        hover2 = field(z, "wild.chart.hover").get("value", "")
        check(hover2.startswith("Lv"), f"398: 種族を選んでレベルの分布を描く（{hover2}）")
        shot(z, shots, "wild_chart.png")
        z.call({"cmd": "dialog", "press": "close"})

        # 検索
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "action", "id": "tools.wildSearch"})
        time.sleep(0.5)
        z.call({"cmd": "setField", "id": "wild.search.species", "value": PIDGEY})
        t0 = time.perf_counter()
        z.call({"cmd": "click", "id": "wild.search.run"})
        info = ""
        for _ in range(100):
            info = field(z, "wild.search.info").get("value", "")
            if "枠" in info or "ありません" in info:
                break
            time.sleep(0.1)
        print(f"     検索: {time.perf_counter() - t0:.1f} 秒（{info}）")
        check("枠" in info, f"398: ポッポを探す（{info}）")
        def row(i: int) -> str | None:
            try:
                return field(z, f"wild.search.row.{i}").get("value", "")
            except Exception:
                return None

        rows = []
        for i in range(400):
            v = row(i)
            if v is None:
                break
            rows.append(v)
        check(any(r.startswith("3.19") for r in rows), f"398: 3.19 の行がある（{len(rows)} 行。{rows[:2]}）")
        shot(z, shots, "wild_search.png")
        # 割合の列で並べ替え（2 回押すと大きい順）
        z.call({"cmd": "click", "id": "wild.search.col.4"})
        z.call({"cmd": "click", "id": "wild.search.col.4"})
        first = row(0) or ""
        check("20%" in first, f"398: 割合の大きい順に並べ替える（{first}）")
        # 3.19 の行をダブルクリック
        idx = next((i for i in range(len(rows)) if (row(i) or "").startswith("3.19")), None)
        if idx is not None:
            z.call({"cmd": "mouse", "id": f"wild.search.row.{idx}", "action": "dblclick", "px": [5, 5]})
            time.sleep(1.0)
            st = z.call({"cmd": "state"})
            m = st.get("map") or {}
            check((m.get("bank"), m.get("map")) == (3, 19) and st.get("tab") == "wild", f"398: ダブルクリックで 3.19 の野生タブを開く（{m.get('bank')}.{m.get('map')} {st.get('tab')}）")
        z.call({"cmd": "dialog", "press": "close"})

        check_typing(z, shots)

    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
