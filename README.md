# ZigzaguMap

CFRU-JP 用のマップエディタです。AdvanceMap 風の操作で、ファイアレッド日本語版（BPRJ）のマップを編集し、`maps\` の JSON として書き出します。ベースROMには書き込みません。仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

## 使い方

- **ROM を開く**: ファイル > ROMを開く（Ctrl+O）か、`.gba` をウィンドウにドラッグ＆ドロップします。素の ROM だけでも閲覧と編集ができます。
- **プロジェクトを開く**: ファイル > CFRU-JPのフォルダを開く で CFRU-JP のフォルダを選びます。ベース ROM は、開いている ROM か、以前そのフォルダと組で開いた ROM を使い、どちらも無ければ選ぶよう求めます。フォルダのドラッグ＆ドロップでも開けます。`maps\BB\MM.json` があるマップはそちらを読みます。
- **最近開いたもの**: ファイルメニューの下に出ます（ROM とフォルダの組で覚えます）。個人設定は `%APPDATA%\io.github.pit-true.zigzagumap\settings.json` に保存します。
- 起動引数で開くこともできます: `zigzagumap.exe [--project <フォルダ>] <ROM>`。「最後に選択したものを覚える」がオンなら、前回のマップとタブを開きます。
- **マップを開く**: 左の一覧の項目をダブルクリックか Enter（AdvanceMap と同じく、選ぶだけでは開きません）。ツール > マップを指定して開く（Ctrl+M）、以前開いたマップを開く（Alt+BkSp）も使えます。
- **元に戻す・やり直す**: Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z も可）。AdvanceMap の「オブジェクトの表示」の Ctrl+Z は、アンドゥに使うため外しています。
- **出力**: ファイル > 出力（Ctrl+S）。素の ROM だけを開いているときは、最初に出力先のフォルダを選びます。ファイル > 出力先を指定して出力 で別のフォルダへ書くこともできます。ファイル > バックアップの作成 も「出力先を指定して出力」と同じです。
- **ROM でないファイル**を開くと、AdvanceMap と同じ「AdvanceMapError(12): Unknown Rom Type! …」を出し、開いていたものはそのまま残します。
- **画像の保存**: ツール > マップ画像の保存／マップ&イベント画像の保存／パレット画像の保存。AdvanceMap と同じ 24 ビットの DIB（BMP と同じ形式）で書きます。マップ画像はブロックだけ（境界ブロックとイベントは含まない）、マップ&イベント画像はイベントの印（オブジェクトの表示がオンなら OW 画像）を重ねたもの、パレット画像はブロックパレット全体（今の横幅、等倍）です。拡張子を付けなければ `.DIB` を足します。AdvanceMap はイベントタブ以外でマップ&イベント画像を保存すると 0 バイトのファイルになりますが、ZigzaguMap はどのタブでもイベントを重ねた画像を書きます。
- **ヘルプ**: ZigzaguMapについて（F1、ツールバーの「?」）、エンドユーザー規約（F2。ZigzaguMap のライセンス）、Read me（この README）。

### マップタブ（マップの設定）

| 操作 | 動作 |
|---|---|
| 左クリック | 選択中のブロックを置く（移動許可は変えない）。スタンプなら押したマスを左上にして全体を置く |
| 左ドラッグ | 通ったマスに置く（1 回の操作にまとまり、1 回のアンドゥで戻る）。スタンプはドラッグしても 1 回だけ置く |
| 右クリック／右ドラッグ | 離したマスのブロックを拾う（パレットが追従してスクロール） |
| Ctrl＋右ドラッグ | 矩形を複数ブロック（スタンプ）として選ぶ。パレット上でも同じ |
| パレットの左・右クリック | ブロックを選ぶ |
| 境界ブロックの左クリック／右クリック | 置く／拾う |

Ctrl＋右ドラッグ（Ctrl＋右クリック）でスタンプを選ぶと、選んだ範囲を等倍で出す小さな窓「Grosser Block」が開きます（× で閉じる。題名の帯をつかんで動かせます）。

設定 > グリッドの表示（Ctrl+G）、設定 > マップサイズの設定 で 2 倍表示、設定 > マップブロックの横幅（Ctrl+P）でパレットの 1 行の数を変えられます。

### 移動エリアタブ（移動エリアの設定）

移動許可の値を色つきで重ね、値を 16 進で描きます。右のパレットで値を選び、左クリック・左ドラッグで書き、右クリックで拾います。設定 > 移動エリアの設定の透明度 の値は AdvanceMap と同じく「マップ側の重み」です（既定 0.3 で、色 70%・マップ 30%）。

### イベントタブ（イベントの設定）

マップのイベントを文字の箱（P=人、橙の S=看板、W=ワープ、緑の S=スクリプト、F=フライトポジション）で描き、右のパネルで選んで編集します。どの編集も Ctrl+Z / Ctrl+Y で戻せます。

| 操作 | 動作 |
|---|---|
| 箱をクリック（左右どちらのボタンでも） | そのイベントを選ぶ。同じマスに重なっていれば、フライトポジション > 看板 > スクリプト > ワープ > 人 の順に上のものを選ぶ |
| 箱をドラッグ | イベントを動かす（1 回のドラッグが 1 回のアンドゥ）。マップの外へも動かせる |
| 箱をダブルクリック | ワープは「マップの移動」、看板・スクリプト・人は「スクリプトを開く」と同じ |
| 種別コンボ・イベント番号 | 選ぶイベントを変える。種別はマップを切り替えても保ち、番号は 0 に戻る |
| カーソルの表示 | 選択中のイベントの赤い枠を出す・消す |
| イベントの削除 | 選択中のイベントを消す（後ろが前に詰まる） |
| イベントマネージャー | 人・看板・ワープ・スクリプトの数を変えて「設定」。増やした分は値が全部 0 のイベントを末尾に足し、減らした分は末尾から消す。イベントの無いマップにも作れる |
| マップの移動（ワープ） | 行き先のマップを開き、行き先のワープを選ぶ。無いマップなら「指定したマップは存在しません！」 |
| スクリプトを開く | 設定 > スクリプトエディターの選択 のエディターを `"<エディター>" "<ROM>" 16F884` の形で起動する（ROM とオフセットの区切りは設定により空白か「:」）。未設定なら「スクリプトエディタが定義されていません！」 |

- 欄の値は入力のたびに反映します（確定ボタンはありません）。同じ欄に続けて入力した分は、1 回のアンドゥでまとめて戻ります。
- 16 進の欄は AdvanceMap と同じく `$` を前に付けて読みます。空欄は 0、あふれた桁は切り捨てます（4 桁の欄の 10000 は 0）。読めない文字を入れると `'$ZZ' is not a valid integer value.` を出し、値は変えません。10 進のスピンは範囲の端に丸めます（300 は 255）。
- スクリプトのオフセットは下位 3 バイトだけを書き、上位 1 バイトは元のままです。
- 看板のイベントタイプが 05〜08 のときは、オフセットの代わりにアイテム ID・隠し ID・個数を出します。
- フライトポジションは ROM の表を読んで表示・編集できますが、`maps\` の形式に置き場所が無いため出力しません。
- 人の落とし物（ItemBalls）は画面では変えません。ほかの欄を編集しても、落とし物は保ったまま出力します。
- マップの外にイベントがあると、ステータスバーの右欄に「ノート:マップの外にイベントがあります。」を出します。
- 設定 > オブジェクトの表示（ツールバーの主人公のボタン）をオンにすると、AdvanceMap と同じく人を ROM の OW 画像（下向きの 1 コマ目）で描き、人以外の箱は描きません。

AdvanceMap と違う点:

- 「マップの移動」で、行き先のマップの、ワープ No. のワープを選びます（AdvanceMap は番号 0 を選ぶ）。
- 未出力の変更があっても、「マップの移動」の前に確認しません（ZigzaguMap はマップごとの変更を持ったまま切り替えるため）。
- アイテム ID の名前は ROM の文字コード表で読みます（AdvanceMap では一部が文字化けする）。
- ポインタが 0 のイベントにスクリプトのオフセットを入れたときは、上位 1 バイトを 08 にします。

### 出現ポケモン・場所の設定タブ

今は表示だけです。出現ポケモンタブの種族は、ROM の種族名表から引いた名前で出します（0 番は「選択してください」）。

## 画面の構成

AdvanceMap 1.92 日本語版に合わせています（文言は `apps/desktop/src/i18n/ja.ts` に集め、Japanese.ini の表記を使います）。

- 上: メニューバー（Alt でフォーカス、矢印キーで移動、Enter・アクセスキーで実行、Esc で閉じる）、ツールバー（AdvanceMap と同じ並び。アイコンは自作の SVG）
- 左: マップ一覧（根は「ヘッダー」「iniファイル」「マップファイル」。並べ替えはツールバーのコンボか 設定 > マップの表示設定 > ヘッダーのソート）と ROM 情報。境目の分割バーで幅を変えられます。設定 > コンボボックス をオンにすると、左の欄の代わりにツールバーの下へ「マップ名」と「マップ」のコンボが出ます（マップを選ぶと開く）。設定 > ツールバーの表示（Ctrl+T）でツールバーを隠せます
- 中央: タブ（マップの設定／移動エリアの設定／イベントの設定／出現ポケモン／場所の設定）
- 下: ステータスバー（左: 座標・ブロック番号・移動許可の説明など、右: 読込時間やノート）
- 未出力のマップは、一覧の名前の後ろに ` *` が付きます。未出力のまま閉じる・別の ROM を開くときは「変更を出力しますか？」と聞きます
- 入力ダイアログ・確認・エラーは画面内に出します（Windows 標準のメッセージボックスと同じ並び）。ファイルやフォルダを選ぶダイアログだけは Windows 標準です
- まだ作っていないメニュー項目も全部置いてあり、押すとステータスバーに「未実装: 項目名」と出ます

## 設定

設定メニューの項目は、押すとすぐ個人設定（`%APPDATA%\io.github.pit-true.zigzagumap\settings.json`）に保存します。ウィンドウの位置と大きさ（最大化を含む）も覚え、次の起動で元に戻します。

| 項目 | ZigzaguMap での動作 |
|---|---|
| グリッドの表示／オブジェクトの表示／マップサイズの設定（拡大表示 5 種）／コンボボックス／ツールバーの表示 | AdvanceMap と同じ（チェックの切り替え） |
| マップの表示設定 > マップヘッダー／INIの表示 | マップ一覧の根を「ヘッダー」だけ／「iniファイル」だけにする。もう一度押すと両方に戻る |
| マップの表示設定 > ヘッダーから新たなIniファイルを作る | 選んだフォルダに `NewMain.ini`（マップ名ごとの「番号=バンク.マップ」）と `NewMaps.ini`（`[バンク.マップ]` の `Name=`）を Shift_JIS で書く |
| マップブロックの横幅（Ctrl+P）／移動エリアの設定の透明度／最近開いたファイルリストの最大数の変更 | 入力ダイアログ。数でない入力は AdvanceMap と同じ「'…' is not a valid integer value.」、範囲外（横幅 0 など）は「それは無効な入力です！正しい値を入力して下さい！」 |
| 最近開いたファイルの設定 > 履歴を削除する／ファイルパスを表示 | AdvanceMap と同じ |
| 言語 | 画面は日本語だけなので Japanese の 1 項目 |
| 最後に選択したものを覚える | 次の起動で前回のマップとタブを開く |
| イベントパネルの非表示／自動的にオフセットを検索する／高度なヘッダーを表示 | チェックを覚えるだけ（AdvanceMap でもイベントパネルの非表示は見た目が変わらない。後の 2 つは今の画面では使わない） |
| 開いたときにバックアップを作成、ツール > ダミーデータへ移す/ヘッダー管理、ダミーデータの検索 | 「ZigzaguMap は ROM へ書き込まないため、この機能は不要です」と案内する |
| スクリプトエディターの選択 | exe を選び、「:」区切りか「 」区切りかを聞く（AdvanceMap と同じ文言）。.exe 以外はエラー |
| 最後に開いたROMのショートカットを作成する | オンにするときに確認する。オンの間は ROM を開くたびに exe と同じフォルダに `Most recently used ROM.gba.lnk` を作る（既定はオフ） |
| コンテキストメニューにAM context menuを追加する | 確認してから、エクスプローラーの .gba の右クリックに「ZigzaguMapで開く」を登録する（現在のユーザーのレジストリ）。もう一度押すと外す |
| ツール > デスクトップにショートカットを作成 | 確認してから、デスクトップに `ZigzaguMap.lnk` を作る |

PC に手を入れる最後の 3 つは、自動操作の入口を付けて起動したときは、確認で「はい」を押しても実行しません。

## 出力の仕様

- 書き出し先は `maps\BB\MM.json`（バンク・マップは 2 桁。ND の `scripts/map_project.py` と BochiBochiEditor 改造版と同じ形式）。
- 書くのは、ベース ROM と内容が違い、既存のファイルとも違うマップだけです。ベース ROM と同じに戻ったマップは、JSON があれば消します。
- 何か書くときに `maps\project.json` が無ければ作ります。
- ベース ROM には書き込みません。

## 構成

- `packages/core`: ROM の解析・描画・操作コマンド（TypeScript。Node とブラウザの両方で動く）
- `apps/desktop`: デスクトップアプリ（Tauri 2 + Vite + 素の TypeScript）

## 開発

Node.js 22 以降、pnpm、Rust（1.96 以降）、WebView2 が必要です。

```sh
pnpm install
pnpm typecheck   # 型チェック
pnpm test        # 単体テスト
```

ROM が要るテストは、環境変数 `ZIGZAGU_TEST_ROM` に素の BPRJ のパスを入れたときだけ実行されます。ROM はリポジトリに入れません。

```powershell
$env:ZIGZAGU_TEST_ROM = "C:\path\to\BPRJ.gba"; pnpm test
```

ND のベース ROM と NeoDark-CFRU のフォルダを `ZIGZAGU_TEST_ND_ROM` と `ZIGZAGU_TEST_ND_PROJECT` に入れると、`maps\` の JSON を読むテストも実行されます（フォルダには書き込みません）。

コアライブラリを Node から使うときは `pnpm --filter @zigzagumap/core build` で `dist` を作ります（`@zigzagumap/core` と `@zigzagumap/core/node`）。マップを PNG に書いて確かめるには次のようにします。

```sh
pnpm --filter @zigzagumap/core dump-map -- <rom> 3 0 out.png --events
pnpm --filter @zigzagumap/core dump-map -- <rom> 3 0 out.png --project <CFRU-JP のフォルダ>
```

アプリの起動とビルド:

```sh
cd apps/desktop
pnpm tauri dev     # 開発用に起動（自動操作の入口がポート 17890 で有効になる）
```

リリース用の exe は `scripts\build.cmd` で作ります（`apps/desktop/src-tauri/target/release/zigzagumap.exe`）。Visual Studio Build Tools の `vcvars64.bat` を読んでから `pnpm tauri build` を実行するので、cmd・PowerShell・Git Bash のどれからでも動きます（Git Bash だけで `pnpm tauri build` を実行すると、Git 付属の `link.exe` が先に見つかって失敗します）。

```sh
scripts\build.cmd          # リリースビルド
scripts\build.cmd debug    # デバッグビルド
scripts\build.cmd check    # cargo check だけ
```

出力先を変えたいときは、環境変数 `CARGO_TARGET_DIR` を設定してから実行します（exe は `<CARGO_TARGET_DIR>\release\zigzagumap.exe` にできます）。

コードの置き場所（`apps/desktop/src`）:

- `app/`: 状態（`EditorState`）、ROM とプロジェクト（`ProjectSession`、`TauriProjectFs`）、マップ一覧の組み立て（`MapCatalog`、`MapTreeModel`）、メニューの定義とアクション、設定、自動操作
- `ui/`: メニューバー、ツールバー、マップ一覧、タブ、ステータスバー、`ui/map/`（マップ表示・パレット・重ね描き）、`ui/tabs/`（各タブ）、`ui/event/`（イベントタブ: 共通部、種別ごとのパネル、マップ上の操作、イベントマネージャー）、`ui/form/`（16 進欄・スピン・コンボなどの入力部品）
- `input/`: マウス操作（ブロック・移動許可の配置）
- `styles/`: 部品ごとの CSS
- 画面の操作はすべて `packages/core` の操作コマンド（`paintBlocks`、`paintMovement`、`paintBorder` など）を CommandBus で実行します

## 自動操作の入口（テスト用）

開発ビルドか、起動引数 `--automation <ポート>` を付けたときだけ、`127.0.0.1:<ポート>` で HTTP の POST を受け付けます（通常の起動では待ち受けません）。リリースの exe に付けたときは、操作を奪わないようウィンドウを画面外に出し、アクティブにしません。

```sh
zigzagumap.exe --automation 17891
node scripts/automation-client.mjs 17891 '{"cmd":"state"}'
node scripts/automation-client.mjs 17891 '{"cmd":"screenshot"}' shot.png
```

本文は JSON 1 件で、返事は `{"ok":true,"result":...}` か `{"ok":false,"error":"..."}` です。

| cmd | 引数 | 動作 |
|---|---|---|
| `open` | `rom`、`project`（省略可） | ROM（とプロジェクトフォルダ）を開く。返事は `state` と同じ |
| `selectMap` | `bank`、`map` | マップを開く。返事の `switchMs` は切り替えにかかった時間 |
| `tab` | `name`（`map` / `movement` / `event` / `wild` / `header`） | タブを切り替える |
| `command` | `name`、`args` | CommandRegistry のコマンドを実行する（例: `{"cmd":"command","name":"paintBlocks","args":{"bank":3,"map":0,"cells":[{"x":5,"y":5,"block":9}]}}`） |
| `undo` / `redo` | | 元に戻す／やり直す |
| `export` | `dir`（素の ROM では必須） | 出力する。返事は書いたファイルと消したファイル |
| `selectBlock` | `block`、または `blocks` と `width` | 選択中のブロックを変える |
| `action` | `id` | メニューのアクションを実行する（例: `view.grid`） |
| `key` | `key`、`ctrl`・`alt`・`shift` | キー操作をまねる（メニューの確認用） |
| `canvasPng` | `tab`（省略時は表示中のタブ） | マップ表示の Canvas（重ね描きとグリッドを含む）を PNG（Base64）で返す |
| `screenshot` | | ウィンドウ全体を PNG（Base64）で返す（PrintWindow で取るので前面に出さない） |
| `cells` | | 表示中のマップの配置とボーダーの値 |
| `state` | | 開いている ROM・プロジェクト・マップ、タブ、選択中のブロック、未出力のマップ、履歴の数、ステータスバー、時間の記録 |
| `dialog` | `input`、`press`（どちらも省略可） | 画面内のダイアログ（入力・確認・エラー・ヘルプの窓）を読む。`input` で入力欄に入れ、`press` でボタンを押す（ボタンの文字列か `ok`・`yes`・`no`・`cancel`。`close` で ×）。返事は開いているダイアログの一覧 |
| `queuePath` | `path`（null でキャンセル） | 次に出るファイル・フォルダのダイアログで選ぶパスを積む（Windows のダイアログは出さない） |
| `pointer` | `target`（`map` / `movement` / `event` / `palette`）、`type`（`down` / `move` / `up`）、`x`・`y`（部品の左上からの表示上のピクセル）、`button`、`ctrl`、`shift` | マウス操作をまねる。返事はステータスバー |
| `exit` | | 確認なしで終了する |
| `ui.list` | `root`（省略可） | 部品の一覧（`data-auto` の ID、値、有効か、表示されているか）。`root` に ID を渡すとその中だけ |
| `ui.get` | `id` | 部品の値 |
| `ui.set` | `id`、`value` | 値を入れて、画面の入力と同じ出来事を送る（コンボは添字か表示の文字列、チェックは true / false）。文字の欄は入力の後に離れる |
| `ui.type` | `id`、`text` | 1 文字ずつ入力する |
| `ui.click` | `id` | ボタンを押す（無効なら失敗） |
| `ui.shot` | `id` | 部品の範囲の画像を PNG（Base64）で返す（例: `event.panel` でイベントタブの右パネル） |
| `setting` | `key`、`value` | 個人設定の値をこの起動の間だけ変える（ファイルには保存しない） |
| `event.select` | `kind`（`person` / `sign` / `warp` / `trap` / `fly`）、`index` | イベントを選ぶ |
| `event.mouse` | `action`（`click` / `drag` / `dblclick` / `hover`）、`x`、`y`、`toX`、`toY` | マップ上のマウス操作（座標はマス）。返事は選択（`hover` はステータスバー） |
| `event.state` | | 選択中の種別と番号、個数、表示中のマップのイベントと落とし物、最後に起動したスクリプトエディター |

イベントタブの部品の ID は `event.kind`、`event.number`、`event.cursor`、`event.remove`、`event.person.x` のような形です（`event.<種別>.<欄>`、イベントマネージャーは `event.manager.persons` と `event.manager.apply`）。

画面側の準備ができる前の要求には `{"ok":false,"error":"画面の準備ができていません"}` を返します。

## 比較テスト

AdvanceMap 1.92 日本語版と ZigzaguMap に同じ操作をさせ、途中の状態（マップ表示領域の画像、入力欄・一覧の値、ダイアログの有無）を比べます（`tests/compare`）。出力まで進めることは確かめますが、出力物の中身は比べません。Windows だけで動きます。

- AdvanceMap は見えない別のデスクトップで起動し、ウィンドウメッセージだけで操作します（`tools/am-harness`）。ZigzaguMap は `--automation` 付きで画面外・非アクティブに起動し、自動操作の入口（ポート 17930〜17939 の空き）から操作します。どちらもユーザーのマウス・キーボードは使いません。
- ROM はシナリオごとに、未編集の ROM から作業用のコピーを作って使います（AdvanceMap が保存しても元は変わりません）。

### 準備

1. リポジトリの外に作業フォルダを作り、AdvanceMap 1.92 日本語版のコピーと素の BPRJ のコピーを置きます（AdvanceMap 本体・ROM・画面キャプチャはリポジトリに入れません）。
2. `pip install -r tools/am-harness/requirements.txt`（Pillow と numpy。仮想環境はリポジトリ外か `.venv`）。
3. `tests/compare/local.config.example.json` を `tests/compare/local.config.json` にコピーし、パスを直します（`.gitignore` 対象）。環境変数でも上書きできます。

| 項目 | 環境変数 | 内容 |
|---|---|---|
| `amSourceDir` | `ZZM_CMP_AM_SRC` | AdvanceMap のコピー（ここから `amWorkDir` を作る） |
| `amWorkDir` | `ZZM_CMP_AM_DIR` | 比較テスト専用の AdvanceMap（Ini の表示設定は毎回戻す） |
| `romOriginal` | `ZZM_CMP_ROM` | 素の BPRJ（読むだけ） |
| `scriptEditorStub` | `ZZM_CMP_STUB` | スクリプトエディタの代わりの exe（省略可） |
| `zigzaguExe` | `ZZM_CMP_EXE` | ZigzaguMap の exe（既定は `apps/desktop/src-tauri/target/release/zigzagumap.exe`） |
| `resultsDir` | `ZZM_CMP_RESULTS` | 結果の置き場（既定はリポジトリの隣の `compare-results`） |
| `keepRuns` | | 残す結果の数（既定 5。これより古い結果は summary に削除候補として書く。自動では消さない） |

exe のビルド出力を別のドライブに置くときは、`CARGO_TARGET_DIR` を設定してから `scripts\build.cmd` を実行し、`zigzaguExe` にその下の `release\zigzagumap.exe` を書きます。

### 実行

```sh
python tests/compare/run.py                         # 全シナリオ
python tests/compare/run.py --scenario S04 S08      # 名前の先頭で選ぶ
python tests/compare/run.py --only-zigzagu          # ZigzaguMap だけ動かし、AdvanceMap は前回の結果と比べる
python tests/compare/run.py --list-ops              # 抽象操作 → 実操作の対応表
python tests/compare/file_issues.py <結果フォルダ>   # 失敗したシナリオを issue にする（--dry-run で本文だけ表示）
```

失敗かエラーがあると終了コード 1 になります。`file_issues.py` は失敗したシナリオごとに issue（ラベル「テスト失敗」、マイルストーン「Phase1」）を作り、同じ題名の issue が開いていればコメントを足します。画像は上げず、結果フォルダ内のパスだけを書きます。

### シナリオ

`tests/compare/scenarios/*.json` に 1 本ずつ書きます。`name`、`title`、`issues`（関連する issue 番号）、`steps`（両アプリに共通の抽象操作の列）を持ちます。

```json
{"op": "selectMap", "bank": 3, "map": 0}
{"op": "selectBlock", "block": 9}
{"op": "dragPaint", "from": [2, 6], "to": [9, 9]}
{"op": "snapshot", "name": "after_drag", "target": "map"}
{"op": "compareFields", "fields": ["status.left", "title.map", "map.size"]}
```

操作の一覧と各アプリでの実現方法は `--list-ops` で出ます（定義は `tests/compare/lib/ops.py`、変換は `lib/drivers.py`）。ZigzaguMap の自動操作の入口にマウス操作の命令がないため、クリックやドラッグはコマンドで「代用」しています（代用した後はステータスバーの比較を「未対応」にします）。メニューの対応は `tests/compare/zigzagu_menu.json` です。

画像の比べ方（`snapshot` の `compare`）:

- `gba`（既定）: 各色を 5bit に落として画素ごとに比べる（AdvanceMap と ZigzaguMap で 8bit への広げ方が違うため）
- `cellMean`: マスごとの平均色で比べる（移動許可の文字の字形の違いを許す）
- `overlayCells`: ブロックだけの画像との差から「重ね描きのあるマス」を求め、その位置だけ比べる（イベントの箱の色や形は比べない）
- `target` に `blocks` を指定すると、どのタブにいてもブロックだけの画像（マップタブ）を比べる

入力欄の値は、全角・半角の空白、16 進の大文字小文字、先頭の `$` や `0x` をそろえてから比べます。

### 結果の見方

`<resultsDir>/<日時>/` に出ます。

- `summary.md` / `summary.json`: シナリオごとの判定と件数、失敗の中身
- `<シナリオ>/report.md`: ステップごとの両者の状態、値の対応表、画像のパス
- `<シナリオ>/<名前>.diff.png`: 左 AdvanceMap、中 ZigzaguMap、右 差分（赤 = 違う画素、黄の枠 = 違うマス）
- `<シナリオ>/advancemap/`・`zigzagu/`: 各スナップショットと窓全体の画像、`steps.json`

判定は「合格」（比べたものがすべて同じ）、「失敗」（違う、または ZigzaguMap がエラーを返した）、「未対応」（失敗はないが、比べられない手順がある）、「エラー」（AdvanceMap 側の操作が通らなかった。テスト側の問題）です。

## ライセンス

MIT（[LICENSE](LICENSE)）
