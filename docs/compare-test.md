# 比較テスト

AdvanceMap 1.92 日本語版と ZigzaguMap に同じ操作をさせ、途中の状態（マップ表示領域の画像、入力欄・一覧の値、ダイアログの有無）を比べます（`tests/compare`）。出力まで進めることは確かめますが、出力物の中身は比べません。Windows だけで動きます。

- AdvanceMap は見えない別のデスクトップで起動し、ウィンドウメッセージだけで操作します（`tools/am-harness`）。ZigzaguMap は `--automation` と `--profile` 付きで画面外・非アクティブに起動し、自動操作の入口（ポート 17930〜17939 の空き）から操作します。プロファイルは結果フォルダの `_zigzagu-profile`（シナリオごとに設定を初期値に戻し、実行の最後に消す）です。どちらもユーザーのマウス・キーボードは使いません。AdvanceMap の警告音・メッセージボックスの音は、ハーネスがそのプロセスの中の音を鳴らす関数を無効にして止めます（`tools/am-harness/README.md`）。
- ROM はシナリオごとに、未編集の ROM から作業用のコピーを作って使います（AdvanceMap が保存しても元は変わりません）。
- 両アプリの設定はシナリオごとに初期状態から始めます。AdvanceMap は `amSourceDir` の `Ini\AdvanceMap.ini` を写し直し（高度なヘッダーの表示・並べ替えなど、押した時点で Ini に書かれるもの）、作成したマップの一覧 `Ini\MapDateien.ini` を空にします（配布物の見本 2 件を消す。ZigzaguMap の個人設定 `mapFiles` も空から始まるため）。ZigzaguMap の場所の設定タブは、AdvanceMap と同じ「くわしく（従来）」の表示にしてから比べます（初期の「かんたん（CFRU）」はユーザーの要望で足した ZigzaguMap だけの表示なので、`tests/automation/feedback_check.py` で確かめる）。

## 準備

1. リポジトリの外に作業フォルダを作り、AdvanceMap 1.92 日本語版のコピーと素の BPRJ のコピーを置きます（AdvanceMap 本体・ROM・画面キャプチャはリポジトリに入れません）。
2. `pip install -r tools/am-harness/requirements.txt`（Pillow と numpy。仮想環境はリポジトリ外か `.venv`）。
3. `tests/compare/local.config.example.json` を `tests/compare/local.config.json` にコピーし、パスを直します（`.gitignore` 対象）。環境変数でも上書きできます。

| 項目 | 環境変数 | 内容 |
|---|---|---|
| `amSourceDir` | `ZZM_CMP_AM_SRC` | AdvanceMap のコピー（ここから `amWorkDir` を作る） |
| `amWorkDir` | `ZZM_CMP_AM_DIR` | 比較テスト専用の AdvanceMap（Ini の表示設定は毎回戻す） |
| `romOriginal` | `ZZM_CMP_ROM` | 素の BPRJ（読むだけ） |
| `scriptEditorStub` | `ZZM_CMP_STUB` | AdvanceMap の Ini に書くスクリプトエディタの代わりの exe（省略可。ZigzaguMap には外部のスクリプトエディタの機能が無い） |
| `zigzaguExe` | `ZZM_CMP_EXE` | ZigzaguMap の exe（既定は `apps/desktop/src-tauri/target/release/zigzagumap.exe`） |
| `resultsDir` | `ZZM_CMP_RESULTS` | 結果の置き場（既定はリポジトリの隣の `compare-results`） |
| `keepRuns` | | 残す結果の数（既定 5。実行の最後に、これより古い結果フォルダを消す。消せなかったものは summary に書く） |
| `langOld` | `ZZM_CMP_LANG_OLD` | AdvanceMap 本体の言語ファイル（既定は `amWorkDir` の `Ini\Sprachen\Japanese.ini`） |
| `langNew` | `ZZM_CMP_LANG_NEW` | ZigzaguMap の文言の基準（既定は `apps/desktop/src/i18n/source/Japanese.ini`） |

exe のビルド出力を別のドライブに置くときは、`CARGO_TARGET_DIR` を設定してから `scripts\build.cmd` を実行し、`zigzaguExe` にその下の `release\zigzagumap.exe` を書きます。

## 実行

```sh
python tests/compare/run.py                         # 全シナリオ
python tests/compare/run.py --scenario S04 S08      # 名前の先頭で選ぶ
python tests/compare/run.py --only-zigzagu          # ZigzaguMap だけ動かし、AdvanceMap は前回の結果と比べる
python tests/compare/run.py --list-ops              # 抽象操作 → 実操作の対応表
python tests/compare/run.py --rejudge <結果フォルダ>  # アプリを動かさず、いまの判定とシナリオの理由書きで判定し直す（手順を変えていないシナリオだけ）
python tests/compare/file_issues.py <結果フォルダ>   # 失敗したシナリオを issue にする（--dry-run で本文だけ表示）
```

失敗かエラーがあると終了コード 1 になります。`file_issues.py` は失敗したシナリオごとに issue（ラベル「テスト失敗」、マイルストーン「Phase1」）を作り、同じ題名の issue が開いていればコメントを足します。画像は上げず、結果フォルダ内のパスだけを書きます。

## シナリオ

`tests/compare/scenarios/*.json` に 1 本ずつ書きます（1 ステップ 1 行）。`name`、`title`、`issues`（関連する issue 番号）、`note`（省略可）、`steps`（両アプリに共通の抽象操作の列）を持ちます。

```json
{"op": "selectMap", "bank": 3, "map": 0}
{"op": "selectBlock", "block": 9}
{"op": "dragPaint", "from": [2, 6], "to": [9, 9]}
{"op": "snapshot", "name": "after_drag", "target": "map"}
{"op": "compareFields", "fields": ["status.left", "title.map", "map.size"]}
```

- 別の窓の部品は `screen` に AdvanceMap のフォームのクラス名（`TBlockEditorForm`・`TPalettenForm`・`TBlockdatenAnpassenForm`・`TWeltkarteForm`・`TAnbindungenForm`・`TMapForm`・`TMapEinfuegenForm`・`TMapBankHeaderForm`・`TCreateWildePokemonForm`）で書きます。AdvanceMap では窓をクラス名で探し、ZigzaguMap では別ウィンドウかメインの中のダイアログへ送ります（`lib/screens.py`）。
- 欄は `field:<部品名>`（値）と `enabled:<部品名>`（押せる・入力できるか）。AdvanceMap に同じ名前の部品が複数あるとき（イベントの各フレームの `Txt_PosX`、野生と場所の設定の `Cbo_Typ` など）は、表示中のもの、その中でフォームが直接持つものを使います。表示していないタブのページの部品は、そのページへ切り替えて読み書きし、元のページへ戻します。
- コンボの選択は位置（番号）で書きます。入力ダイアログは `answerDialog` の `input`、× は `button: "close"`、ファイルを選ぶダイアログは `answerFile`（結果フォルダの中の名前。`null` で取り消し）。別の窓のメニューは `menu` に `screen` と AdvanceMap の文言の `path`、ZigzaguMap のアクション ID の `zigzagu` を書きます。部品の中のクリックは `clickComp`、部品の画像は `snapshot` の `target: "comp"`、両アプリが書いた画像ファイルは `compareFile` で比べます。

操作の一覧と各アプリでの実現方法は `--list-ops` で出ます（定義は `tests/compare/lib/ops.py`、変換は `lib/drivers.py`）。ZigzaguMap のクリックやドラッグは自動操作の入口の `mouse`（画面と同じ処理を通る）、入力欄とボタンは `setField` / `click` の `field:<AdvanceMap の部品名>`、ダイアログは `dialogs` / `dialog` で行います。

文言の扱い:

- メニューはシナリオに言語ファイルのキー（`"key": ["Menue.12", "Menue.120"]`。`menu.state:Menue.12/Menue.120` も同じ）で書きます。AdvanceMap 側は本体の言語ファイル（`Ini\Sprachen\Japanese.ini`、cp932）の文言で、ZigzaguMap 側は文言の基準（`apps/desktop/src/i18n/source/Japanese.ini` に `overrides.ini` を重ねたもの。`scripts/gen-i18n.mjs` と同じ規則）の文言で `menu.run` します。文言で見つからない項目は `tests/compare/zigzagu_menu.json`（キーの階層 → アクション ID）で実行します。コンボの選択は番号で書きます。
- ZigzaguMap の文言の基準は、AdvanceMap 本体の言語ファイルと同じキーで 500 件ほど文言が違います。比べる前に、AdvanceMap 側で読んだ文字列（欄の値・一覧・メニュー・ダイアログ）を、両方の言語ファイルをキー（セクション名.番号）で対応づけた表で新しい文言へ読み替えます（`lib/langmap.py`。新しい文言の頭の `(AM1.95未使用)` などの注記は外す。同じ旧文言が別々の新文言になるものは読み替えない）。表に無い文字列の食い違いは失敗のままです。言語ファイルの場所は設定の `langOld`（既定は `amWorkDir` の `Ini\Sprachen\Japanese.ini`）と `langNew` で変えられます。
- ダイアログは、AdvanceMap のメッセージボックス（#32770）と ZigzaguMap の画面内のダイアログを題名・本文・ボタン（アクセスキーの表記を除く）で、AdvanceMap の VCL のフォームと ZigzaguMap の別ウィンドウは題名だけで比べます。

画像の比べ方（`snapshot` の `compare`）:

- `gba`（既定）: 各色を 5bit に落として画素ごとに比べる（AdvanceMap と ZigzaguMap で 8bit への広げ方が違うため）
- `cellMean`: マスごとの平均色で比べる（移動許可の文字の字形の違いを許す）
- `overlayCells`: ブロックだけの画像との差から「重ね描きのあるマス」を求め、その位置だけ比べる（イベントの箱の色や形は比べない）
- `target` に `blocks` を指定すると、どのタブにいてもブロックだけの画像（マップタブ）を比べる

表示の見え方:

- AdvanceMap は比較のために大きな窓（2400×1600）で動かしているので、スクロールを比べるシナリオは先に `resizeWindow`（`width`・`height`）で両アプリの窓の大きさをそろえます。`scrollView`（`target`、`to`: `end` / `start`）で表示領域のスクロールバーを端へ動かし、`compareFields` の `view.scroll:<target>` で横・縦のスクロールバーが出ていて使えるかを比べます（AdvanceMap は枠のウィンドウの WS_HSCROLL / WS_VSCROLL、ZigzaguMap は自動操作の `view.scroll`）。大きいマップ（3.6）と 2 倍表示で、はみ出した部分までスクロールできることを確かめます（`S56_view_scroll`）。
- `export` に `dir` を付けると、ZigzaguMap はその名前のフォルダ（結果フォルダの中）へ出力します。`output.files:<dir>` は ZigzaguMap が書いたファイルの一覧で、`only: "zigzagu"` と `expected` で確かめます（`S57_export_to_other_folder`）。

入力欄の値は、全角・半角の空白、16 進の大文字小文字、先頭の `$` や `0x` をそろえてから比べます。

Phase1 のフィードバック（issue #169〜#181）で AdvanceMap と違う動きにしたもの:

- ZigzaguMap は見た目の項目を「設定」から「表示」へ移したので、`menu.state` では ZigzaguMap の「表示」の下の項目を「設定」の下として読み、同じ項目どうしを比べます（`lib/drivers.py` の `VIEW_MENU`）。シナリオのメニューは今までどおり AdvanceMap の言語ファイルのキーで書き、ZigzaguMap で文言の階層が見つからない項目は `zigzagu_menu.json` のアクション ID で実行します。
- 消した機能のシナリオ（S17 スクリプトエディタの選択と起動、S51 マップの表示設定（ini の表示））は外しました。
- 入力ダイアログをスライダーにした移動エリアの透明度（S09）などは、AdvanceMap だけの手順（`only: "advancemap"`）と ZigzaguMap だけの手順（`only: "zigzagu"`）に分け、理由「ユーザーの要望（Phase1 のフィードバック #番号）」を書いています。

## 結果の見方

`<resultsDir>/<日時>/` に出ます。

- `summary.md` / `summary.json`: シナリオごとの判定と件数、失敗の中身
- `<シナリオ>/report.md`: ステップごとの両者の状態、値の対応表、画像のパス
- `<シナリオ>/<名前>.diff.png`: 左 AdvanceMap、中 ZigzaguMap、右 差分（赤 = 違う画素、黄の枠 = 違うマス）
- `<シナリオ>/advancemap/`・`zigzagu/`: 各スナップショットと窓全体の画像、`steps.json`（AdvanceMap 側の `mutedSounds` は、止めた効果音の関数が呼ばれた回数）

判定は「合格」（比べたものがすべて同じか、シナリオに理由を書いた仕様上の違いだけ）、「失敗」（違う、または ZigzaguMap がエラーを返した）、「未対応」（失敗はないが、比べられない手順がある）、「エラー」（AdvanceMap 側の操作が通らなかった。テスト側の問題）、「保留」（要判断の結論待ちの違いがある）です。

## 仕様上の違いと保留

SPEC やこれまでの判断で決めた違いは、黙って外さず、シナリオのステップに理由を書きます。summary.md の「仕様上の違いとして除外したステップ・欄」「保留（要判断）」に一覧で出ます。

| 書き方 | 意味 |
|---|---|
| `"expectedDifference": "理由"` | このステップが違っても「仕様上の違い」（失敗に数えない） |
| `"expectedDifference": {"field:X": "理由"}` | compareFields の欄ごと。`menu.state` のような辞書の欄は `{"menu.state": {"ファイル/ROMの保存": "理由", "設定/言語/*": "理由"}}` と項目ごと（ワイルドカード可。理由の無い項目が違えば失敗） |
| `"expectedDifference": {"title": "理由"}` | expectDialog で、題名（アプリ名など）だけの違いを許す。本文とボタンは比べる |
| `"pending": "要判断 #番号: 理由"` | 違っても「保留」。項目ごとなら `{"pending": "…"}` を値に書く |
| `"only": "zigzagu"`（または `"advancemap"`）と `expectedDifference` | 片方のアプリだけで行う手順。ZigzaguMap だけの compareFields は `expected`（AdvanceMap の調査記録の値）と比べる（素の BPRJ で開けないワールドマップエディターなど） |
| `compare` の `maxDiffRatio` と `expectedDifference` | 違う画素の割合がこれ以下なら「仕様上の違い」（マップ＆イベント画像の約 3% など） |

上の一覧に無い食い違いを仕様上の違いにしたいときは、issue にラベル「要判断」を付けて両者の挙動を書き、そのステップを `pending` にします。
