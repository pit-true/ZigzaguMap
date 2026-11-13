"""両アプリに共通の抽象操作の一覧。

シナリオの各ステップは {"op": 名前, ...引数} の形。ドライバーは名前ごとに実操作へ変換する。
- observe: 状態を読むだけの操作（比較の対象）。それ以外は状態を変える操作。
- taints: どちらかのアプリで未対応（または代用）だったとき、以後の比較を「未対応」扱いにする範囲。
  "all"（全部）、"status"（ステータスバー）、"dialog"（ダイアログ）など。比べる側の scope と重なれば未対応になる。
"""
from __future__ import annotations

OPS: dict[str, dict] = {
    # --- 起動・ROM・マップ
    "openRom": dict(args={}, taints=["all"], desc="ファイル > ROMを開く で作業用 ROM を開く"),
    "selectMap": dict(args={"bank": "int", "map": "int"}, taints=["all"], desc="マップ一覧から開く（Enter）"),
    "selectTab": dict(args={"tab": "map|movement|event|wild|header"}, taints=["all"], desc="タブを切り替える"),
    "sortTree": dict(args={"mode": "int 0-4"}, taints=["tree"], desc="マップ一覧の並べ替え"),
    # --- ブロック
    "selectBlock": dict(args={"block": "int"}, taints=["all"], desc="ブロックパレットのブロックを左クリック"),
    "pickPaletteStamp": dict(args={"from": "[x,y]", "to": "[x,y]"}, taints=["all"], desc="パレット上で Ctrl＋右ドラッグ（複数ブロック）"),
    "paintBlock": dict(args={"x": "int", "y": "int"}, taints=["all"], desc="マップを左クリック（選択中のブロックを置く）"),
    "dragPaint": dict(args={"from": "[x,y]", "to": "[x,y]", "steps": "int=8"}, taints=["all"], desc="マップを左ドラッグ"),
    "pickBlock": dict(args={"x": "int", "y": "int"}, taints=["all"], desc="マップを右クリック（スポイト）"),
    "pickStamp": dict(args={"from": "[x,y]", "to": "[x,y]"}, taints=["all"], desc="マップを Ctrl＋右ドラッグ（スタンプ）"),
    "paintBorder": dict(args={"x": "0-1", "y": "0-1"}, taints=["all"], desc="境界ブロックを左クリック"),
    "pickBorder": dict(args={"x": "0-1", "y": "0-1"}, taints=["all"], desc="境界ブロックを右クリック"),
    "hover": dict(args={"x": "int", "y": "int", "target": "map|movement|event"}, taints=["status"], desc="マップ上にマウスを置く（ステータスバー用）"),
    # --- 移動許可
    "selectMovement": dict(args={"value": "int"}, taints=["all"], desc="移動許可パレットの値を左クリック"),
    "paintMovement": dict(args={"x": "int", "y": "int"}, taints=["all"], desc="移動エリアを左クリック"),
    "dragMovement": dict(args={"from": "[x,y]", "to": "[x,y]", "steps": "int=8"}, taints=["all"], desc="移動エリアを左ドラッグ"),
    "pickMovement": dict(args={"x": "int", "y": "int"}, taints=["all"], desc="移動エリアを右クリック"),
    # --- メニュー・入力欄・ボタン・ダイアログ
    "menu": dict(args={"key": "[言語ファイルのキー Menue.N]"}, taints=["all"], desc="メインメニューの項目を実行"),
    "setField": dict(args={"screen": "str", "field": "str", "value": "str|int"}, taints=["all"], desc="入力欄・コンボの値を変える"),
    "clickButton": dict(args={"screen": "str", "button": "str"}, taints=["all"], desc="ボタンを押す"),
    "clickEvent": dict(args={"x": "int", "y": "int"}, taints=["all"], desc="イベントタブのマップをクリック"),
    "dragEvent": dict(args={"from": "[x,y]", "to": "[x,y]"}, taints=["all"], desc="イベントをドラッグ"),
    "answerDialog": dict(args={"button": "str"}, taints=["all"], desc="開いているダイアログのボタンを押す"),
    "export": dict(args={}, taints=[], desc="出力（AdvanceMap は ROM の保存）。出力物は比べない"),
    "wait": dict(args={"seconds": "float"}, taints=[], desc="待つ"),
    # --- 比べる（observe）
    "snapshot": dict(args={"name": "str", "target": "map|movement|event|blocks|border|palette", "compare": "{mode,...}"},
                     observe=True, scope="image", desc="表示領域の画像を取り、画素で比べる"),
    "compareFields": dict(args={"fields": "[欄の ID]"}, observe=True, scope="fields", desc="欄の値を正規化して比べる"),
    "expectDialog": dict(args={"present": "bool=true", "text": "str（部分一致、省略可）"}, observe=True, scope="dialog",
                         desc="ダイアログの有無と題名・本文・ボタンを比べる"),
}

# 欄の ID（compareFields）。scope は taints との重なりを見るためのもの。
FIELDS: dict[str, dict] = {
    "status.left": dict(scope="status", desc="ステータスバー左欄"),
    "title.map": dict(scope="all", desc="題名の「 - 」より後（マップ名と番号）"),
    "map.size": dict(scope="all", desc="マップの横幅x高さ（ブロック）"),
    "tab": dict(scope="all", desc="表示中のタブ（map/movement/event/wild/header）"),
    "tree.roots": dict(scope="tree", desc="マップ一覧の根の項目名"),
    "tree.count": dict(scope="tree", desc="マップ一覧の項目数"),
    "tree.first60": dict(scope="tree", desc="マップ一覧の先頭 60 件（文字列と深さ）"),
    "menu.state": dict(scope="all", desc="メニュー全項目の灰色・チェック（menu.state:Menue.12/Menue.120 のようにキーの階層で 1 項目）"),
    "romInfo": dict(scope="all", desc="左下の ROM 情報 4 行"),
    "dialogs": dict(scope="dialog", desc="開いているダイアログ"),
}
# "field:<部品名>"（AdvanceMap の Delphi 部品名）で任意の入力欄も指定できる。


def taints_of(step: dict) -> set[str]:
    spec = OPS.get(step["op"], {})
    return set(step.get("taints", spec.get("taints", ["all"])))


def scope_of(step: dict, field: str | None = None) -> str:
    if field is not None:
        base = field.split(":", 1)[0]
        return FIELDS.get(field, FIELDS.get(base, {})).get("scope", "all")
    return OPS[step["op"]].get("scope", "all")


def validate(scn: dict) -> list[str]:
    errs = []
    for k in ("name", "issues", "steps"):
        if k not in scn:
            errs.append(f"{k} がありません")
    for i, st in enumerate(scn.get("steps", [])):
        if st.get("op") not in OPS:
            errs.append(f"ステップ {i}: 知らない op {st.get('op')!r}")
    return errs
