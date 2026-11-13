# AdvanceMap 1.92 自動操作ハーネス

AdvanceMap を「見えない別デスクトップ」で起動し、ウィンドウメッセージだけで操作する。
ユーザーの画面・マウス・キーボードには一切触れない（実カーソル移動、SendInput、フォーカスを奪う操作は使わない）。

## 仕組み

| 項目 | 方法 |
|---|---|
| 起動 | `CreateDesktopW("ZZM_AM_<pid>")` → `CreateProcessW`（`STARTUPINFO.lpDesktop = "WinSta0\ZZM_AM_<pid>"`）。ROM はコマンドライン引数で渡すと起動時に読み込まれる |
| 操作スレッド | Python のメインスレッドを `SetThreadDesktop` で同じデスクトップへ移す（ウィンドウの列挙・メッセージ送信のため） |
| メニュー | `GetMenu`/`GetSubMenu` でたどり、`WM_COMMAND(id)` を `PostMessage` |
| クリック・ドラッグ | `WM_MOUSEMOVE`/`WM_LBUTTONDOWN`/`UP`（`MK_SHIFT`/`MK_CONTROL` は wParam）を `PostMessage`。ウィンドウを持たない VCL 部品（TImage, TDXPaintBox, TLabel）は親ウィンドウの座標に換算して送る |
| キー | `WM_KEYDOWN`/`WM_CHAR` を `PostMessage`。Ctrl/Shift は対象スレッドの `SetKeyboardState`（`AttachThreadInput` 中だけ。隠しデスクトップ側の入力状態だけが変わる） |
| タブ | タブ見出しへの送信クリック（だめなら `TCN_SELCHANGING`/`TCM_SETCURSEL`/`TCN_SELCHANGE` の通知） |
| ツリー/タブ/ステータスバー | 共通コントロールのメッセージ。構造体は AdvanceMap（32bit）のプロセス内に `VirtualAllocEx` で確保して読み書き |
| 画面取得 | `PrintWindow(PW_RENDERFULLCONTENT)`。隠しデスクトップでも描画される。`BitBlt` は隠しデスクトップでは画面の別内容が混じるので使わない |
| 部品名の取得 | Delphi の `ControlOfs<HInstance><ThreadId>` ウィンドウプロパティ → プロセスメモリの `TComponent.FName`。ウィンドウを持たない部品も、フォームの `FComponents` をたどって位置・表示状態・文字列・ヒントを読む（`vcl_dump`） |
| 音 | 起動直後に、その AdvanceMap のプロセスの中の音を鳴らす関数（`user32!MessageBeep`、`win32u!NtUserMessageBeep`・`NtUserPlayEventSound`（メッセージボックスの警告音）、`Beep`、`winmm!PlaySound*`・`sndPlaySound*`）の先頭を、呼ばれた回数を数えて何もせず戻る小さな関数への jmp に書き換える（`mute.py`。`winmm.dll` は先に読み込ませてから書き換える）。ほかのプロセスとシステムの音の設定には触れない。既定で有効（`AM(mute=False)` か環境変数 `ZZM_AM_SOUND=1` で無効）。呼ばれた回数は `AM.sound_counts()` |
| フォーム定義 | `dump_dfm.py`: 実行中プロセスのメモリ（UPX 展開後）から TPF0 リソースを読み、テキストの DFM へ変換（`<work>/inventory/_ref/dfm/`。`dump_dfm_images.py` で埋め込み画像も取り出せる） |

## 準備

AdvanceMap 本体・ROM・スクリーンショットはリポジトリに入れない。リポジトリの外に作業フォルダ（以下 `<work>`）を作り、そこに AdvanceMap 1.92 日本語版のコピー（`<work>\am192`）と素の BPRJ（`<work>\rom\BPRJ_orig.gba`）を置く。元の AdvanceMap や元の ROM は直接使わない。

```
pip install -r tools\am-harness\requirements.txt      # Pillow と numpy（仮想環境はリポジトリ外か .gitignore 対象の .venv）
set ZZM_WORK=<work>
python tools\am-harness\make_worker.py NAME --stub <ScriptEditorStub.exe>   # <work>\am192_NAME\ と <work>\rom\BPRJ_NAME.gba を作る
set ZZM_AM_DIR=<work>\am192_NAME
set ZZM_ROM=<work>\rom\BPRJ_NAME.gba
set ZZM_SHOTS=<work>\shots
set PYTHONIOENCODING=utf-8
python your_script.py      # tools\am-harness を sys.path に入れて `from am import *`
```

- 並行して動かすときは、作業ごとに別の NAME にする（AdvanceMap の Ini と ROM を分けるため）。
- `make_worker.py NAME --reset-rom` で作業用 ROM を素の状態に戻せる。
- `--stub` を付けると、Ini のスクリプトエディタを `stub\ScriptEditorStub.exe` にする。「スクリプトを開く」を押しても、渡されたコマンドラインが exe と同じフォルダの `ScriptEditorStub.log` に追記されるだけで、外部エディタは起動しない。exe は `stub\ScriptEditorStub.cs` を `csc ScriptEditorStub.cs` でビルドして作る（リポジトリには入れない）。
- 音が鳴っていないかは `powershell -NoProfile -ExecutionPolicy Bypass -File toolsm-harnessudio_peaks.ps1 -Seconds 60` で確かめられる（既定の再生デバイスの音声セッションごとのピークの最大値を JSON で出す。読むだけで設定は変えない。`system-sounds` がメッセージボックスなどのシステム音）。
- 比較テスト（`tests/compare`）はこのライブラリを使う。使い方はリポジトリの README の「比較テスト」。

## 基本の使い方

```python
from am import *
am = AM()
try:
    am.start()                    # 隠しデスクトップで起動し、ZZM_ROM を開く（rom=None で ROM なし）
    am.select_map(3, 0)           # マップ一覧から 3.0 を開く（ステータスバーの「マップの読込完了 3.0」で確認）
    am.tab("event")               # map / move / event / wild / header または 0-4
    am.shot("tabs/3_0_event")     # shots/tabs/3_0_event.png（ウィンドウ全体）
    am.shot_comp("x/mapbox", "MapBox")   # 部品だけ切り出し
    print(am.controls_md())       # 全部品の Markdown 表（コンボボックスの中身つき）
finally:
    am.shutdown()                 # AdvanceMap を終了し、デスクトップを片付ける（必ず呼ぶ）
```

## 関数一覧（`am.py` の `AM` クラス）

起動・終了
- `start(rom=ZZM_ROM)` / `shutdown()` / `kill()`（自分が起動したプロセスだけ終了）/ `restart()` / `alive()` / `hung()`
- `close()`: `WM_CLOSE` を送り、確認ダイアログには「いいえ」で答える

ROM・マップ
- `open_rom(path)`: メニュー「ファイル > ROMを開く」→ ファイルダイアログに入力
- `select_map(bank, map)` / `map_items()`（ツリーの全項目）
- `tab(name|index)` / `status()`（ステータスバーの各欄）

メニュー
- `menu("ツール", "マップを指定して開く")`: ラベルは `&`・`(X)`・ショートカット表記を除いて比べる
- `menu_items()`: 全項目（階層、ID、チェック、灰色）。`refresh_menu_states()` で VCL にチェック状態を更新させてから読む

ウィンドウ・部品
- `windows()` / `find_window(title=, cls=)` / `wait_new_window(before)` / `describe(h)`
- `tree(top)` / `tree_text(top)` / `flat(top)`: ウィンドウを持つ部品のツリー（クラス名・文字列・位置・ID）
- `vcl_dump(top)` / `controls_md(top)` / `comp(name)`: VCL 部品（ウィンドウなしも含む）の名前・位置・大きさ・表示・有効・文字列・ヒント
- `by_name(name)` / `names(top)`: Delphi の部品名 → ウィンドウハンドル

入力
- `edit(name, value=None)`: 入力欄の読み書き（`WM_SETTEXT` をタイムアウト付きで送る。EN_CHANGE は入力欄自身が出すので OnChange が 1 回動く）
- `combo(name, select=None)`: 選択肢の一覧と選択位置。`select` に番号か文字列（`CBN_SELCHANGE` を親へ送るので OnChange が動く）
- `button(name)` / `click_button(hwnd)`: `BM_CLICK` を Post（モーダルが開いても止まらない）
- `check(hwnd)`: チェックボックスの状態
- `click(hwnd, x, y, button=, keys=, double=)` / `drag(...)` / `key(hwnd, vk, ctrl=, shift=, alt=)` / `type_text(hwnd, s)`
- `click_comp(name, x, y)` / `drag_comp(...)`: ウィンドウなし部品の中の座標
- `map_click(bx, by, button="left", keys=MK_SHIFT|MK_CONTROL, comp="MapBox"|"GehBox"|"EventBox")` / `map_drag((x0,y0),(x1,y1))`: ブロック座標で操作
- `palette_click(index, comp="BlockPalette"|"GehPalette")`

ダイアログ
- `msgboxes()` / `dialog_info(h)`（題名・本文・ボタン）/ `press(h, "OK")` / `dismiss_dialogs(button_pref=(...))`
- `file_dialog(path)`: 開く/保存ダイアログのファイル名欄に入れて OK

画像
- `shot(name, h=None)` / `shot_comp(name, comp)` / `capture(h)`（PIL Image）

## 実マウスが必要だった操作

- ツールバーのヒント（吹き出し）の表示: VCL が実カーソル位置で出す。文字列は `vcl_dump` の `hint` で取れる。
- パレットエディタの「色の選択」（スポイト）: 実カーソル下の画面色を読む。

メッセージでは動かないので別の手段を使うもの:

- Ctrl を伴うショートカット（Ctrl+M、Ctrl+Z など）は `key()` では反応しない。`menu()` で同じ項目を実行する。F キー、Enter、Alt+BkSp は `key()` で動く。
- マウスホイールは効かない。スクロールバーへ `WM_VSCROLL`/`WM_HSCROLL` を送る。
- 素の BPRJ のワールドマップエディターは AdvanceMap 自体がエラーを出して非表示のまま残る。`user32.ShowWindow(h, 5)` で表示させる。

詳しくは作業フォルダの調査メモ（`inventory/00_index.md` の「自動操作の方式と制限」）。

## 使うときの注意（調査で分かったこと）

- 設定メニューの切り替え（グリッド、拡大表示、オブジェクトの表示、高度なヘッダーなど）は押した瞬間に `am192_NAME\Ini\AdvanceMap.ini` に保存され、再起動後も残る。試行の前に `make_worker.reset_view_settings(AM_DIR)` で戻す。
- `AM(am_dir=..., shots=...)` でワーカーのフォルダとスクリーンショットの置き場を直接渡せる（環境変数より優先）。
- モーダルなダイアログが開いている間に別ウィンドウの部品を読むときは `comp(name, top=h)` のように対象のウィンドウを渡す。
- 同じ名前の部品が複数ある（Cbo_Typ、Txt_Script、Spin_Nr など）。`comp(name, parent="Frame_People1")` で親を指定する。
- 非表示のページの部品はまだウィンドウを持たない（`hwnd` がない）。タブを一度表示してから読む。
- `vcl_dump` は 1 回に数百 ms〜数秒かかる。ループの中では hwnd を覚えておいて使う。
- 長い処理はログをファイルに書き、パイプ（`| tail` など）を通さない（固まったときに何も見えなくなる）。

## 注意

- 次の操作は PC 全体に影響するので実行しない: 「コンテキストメニューにAM context menuを追加する」（レジストリ）、「デスクトップにショートカットを作成」（実デスクトップに .lnk）、ヘルプの「Read me」（既定のテキストエディタが通常デスクトップで開く可能性がある）。
- AdvanceMap が応答しなくなったら `am.kill()` → `am.start()`。ほかのプロセスには触らない。
