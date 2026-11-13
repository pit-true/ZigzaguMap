"""シナリオの `screen`（AdvanceMap のフォームのクラス名）と、両アプリでの居場所の対応。

AdvanceMap の窓は題名が文言の改訂や状態で変わるので、VCL のフォームのクラス名で探す。
ZigzaguMap では別ウィンドウ（ラベル）か、メインの中のダイアログ（None）になる。
"""
from __future__ import annotations

# クラス名 → (ZigzaguMap のウィンドウのラベル。None はメインの中のダイアログ, 以前のシナリオで使っていた題名)
SCREENS: dict[str, tuple[str | None, tuple[str, ...]]] = {
    "TBlockEditorForm": ("block-editor", ("ブロックエディタ",)),
    "TPalettenForm": ("palette-editor", ("パレットエディタ",)),
    "TBlockdatenAnpassenForm": ("block-adjust", ("一括",)),
    "TWeltkarteForm": ("world-map", ("ワールドマップ",)),
    "TAnbindungenForm": (None, ("コネクションマネージャー", "マップの移動")),
    "TMapForm": (None, ("新しいマップ", "新規マップ")),
    "TMapEinfuegenForm": (None, ("マップの追加/挿入",)),
    "TMapBankHeaderForm": (None, ("マップバンクヘッダー",)),
    "TCreateWildePokemonForm": (None, ("野生ポケモンの追加",)),
}


def form_class(screen: str | None) -> str | None:
    """シナリオの screen → AdvanceMap のフォームのクラス名（メインなら None）。"""
    if not screen or screen == "main":
        return None
    if screen in SCREENS:
        return screen
    for cls, (_, titles) in SCREENS.items():
        if any(t in screen for t in titles):
            return cls
    raise KeyError(f"知らない screen: {screen!r}（lib/screens.py の SCREENS に足す）")


def zigzagu_window(screen: str | None) -> str | None:
    """シナリオの screen → ZigzaguMap のウィンドウのラベル（メインなら None）。"""
    cls = form_class(screen)
    return SCREENS[cls][0] if cls else None
