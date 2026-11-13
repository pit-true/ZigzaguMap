# ZigzaguMap

CFRU-JP 用のマップエディタです。AdvanceMap 風の操作で、ファイアレッド日本語版（BPRJ）のマップを編集し、`maps\` の JSON として書き出します。ベースROMには書き込みません。仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

## 使い方

- **ROM を開く**: ファイル > ROMを開く（Ctrl+O）か、`.gba` をウィンドウにドラッグ＆ドロップします。素の ROM だけでも閲覧と編集ができます。
- **プロジェクトを開く**: ファイル > CFRU-JPのフォルダを開く で CFRU-JP のフォルダを選びます。ベース ROM は、開いている ROM か、以前そのフォルダと組で開いた ROM を使い、どちらも無ければ選ぶよう求めます。フォルダのドラッグ＆ドロップでも開けます。`maps\BB\MM.json` があるマップはそちらを読みます。
- **最近開いたもの**: ファイルメニューの下に出ます（ROM とフォルダの組で覚えます）。個人設定は `%APPDATA%\io.github.pit-true.zigzagumap\settings.json` に保存します。
- 起動引数で開くこともできます: `zigzagumap.exe [--project <フォルダ>] <ROM>`。「最後に選択したものを覚える」がオンなら、前回のマップとタブを開きます。
- **マップを開く**: 左の一覧の項目をダブルクリックか Enter（AdvanceMap と同じく、選ぶだけでは開きません）。ツール > マップを指定して開く（Ctrl+M）、以前開いたマップを開く（Alt+BkSp）も使えます。
- **元に戻す・やり直す**: Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z も可）。AdvanceMap の「オブジェクトの表示」の Ctrl+Z は、アンドゥに使うため外しています。
- **出力**: ファイル > 出力（Ctrl+S）。素の ROM だけを開いているときは、最初に出力先のフォルダを選びます。ファイル > 出力先を指定して出力 で別のフォルダへ書くこともできます。

### マップタブ（マップの設定）

| 操作 | 動作 |
|---|---|
| 左クリック | 選択中のブロックを置く（移動許可は変えない）。スタンプなら押したマスを左上にして全体を置く |
| 左ドラッグ | 通ったマスに置く（1 回の操作にまとまり、1 回のアンドゥで戻る）。スタンプはドラッグしても 1 回だけ置く |
| 右クリック／右ドラッグ | 離したマスのブロックを拾う（パレットが追従してスクロール） |
| Ctrl＋右ドラッグ | 矩形を複数ブロック（スタンプ）として選ぶ。パレット上でも同じ |
| パレットの左・右クリック | ブロックを選ぶ |
| 境界ブロックの左クリック／右クリック | 置く／拾う |

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

AdvanceMap と違う点:

- 「マップの移動」で、行き先のマップの、ワープ No. のワープを選びます（AdvanceMap は番号 0 を選ぶ）。
- 未出力の変更があっても、「マップの移動」の前に確認しません（ZigzaguMap はマップごとの変更を持ったまま切り替えるため）。
- アイテム ID の名前は ROM の文字コード表で読みます（AdvanceMap では一部が文字化けする）。
- ポインタが 0 のイベントにスクリプトのオフセットを入れたときは、上位 1 バイトを 08 にします。

### 出現ポケモン・場所の設定タブ

今は表示だけです。

## 画面の構成

AdvanceMap 1.92 日本語版に合わせています（文言は `apps/desktop/src/i18n/ja.ts` に集め、Japanese.ini の表記を使います）。

- 上: メニューバー（Alt でフォーカス、矢印キーで移動、Enter・アクセスキーで実行、Esc で閉じる）、ツールバー（AdvanceMap と同じ並び。アイコンは自作の SVG）
- 左: マップ一覧（根は「ヘッダー」「iniファイル」「マップファイル」。並べ替えはツールバーのコンボか 設定 > マップの表示設定 > ヘッダーのソート）と ROM 情報。境目の分割バーで幅を変えられます
- 中央: タブ（マップの設定／移動エリアの設定／イベントの設定／出現ポケモン／場所の設定）
- 下: ステータスバー（左: 座標・ブロック番号・移動許可の説明など、右: 読込時間やノート）
- 未出力のマップは、一覧の名前の後ろに ` *` が付きます。未出力のまま閉じる・別の ROM を開くときは「変更を出力しますか？」と聞きます
- まだ作っていないメニュー項目も全部置いてあり、押すとステータスバーに「未実装: 項目名」と出ます

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

コードの置き場所（`apps/desktop/src`）:

- `app/`: 状態（`EditorState`）、ROM とプロジェクト（`ProjectSession`、`TauriProjectFs`）、マップ一覧の組み立て（`MapCatalog`、`MapTreeModel`）、メニューの定義とアクション、設定、自動操作
- `ui/`: メニューバー、ツールバー、マップ一覧、タブ、ステータスバー、`ui/map/`（マップ表示・パレット・重ね描き）、`ui/tabs/`（各タブ）、`ui/event/`（イベントタブ: 共通部、種別ごとのパネル、マップ上の操作、イベントマネージャー）、`ui/form/`（16 進欄・スピン・コンボなどの入力部品とメッセージ）
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
| `exit` | | 確認なしで終了する |
| `ui.list` | `root`（省略可） | 部品の一覧（`data-auto` の ID、値、有効か、表示されているか）。`root` に ID を渡すとその中だけ |
| `ui.get` | `id` | 部品の値 |
| `ui.set` | `id`、`value` | 値を入れて、画面の入力と同じ出来事を送る（コンボは添字か表示の文字列、チェックは true / false）。文字の欄は入力の後に離れる |
| `ui.type` | `id`、`text` | 1 文字ずつ入力する |
| `ui.click` | `id` | ボタンを押す（無効なら失敗） |
| `ui.shot` | `id` | 部品の範囲の画像を PNG（Base64）で返す（例: `event.panel` でイベントタブの右パネル） |
| `ui.dialog` | `press`（省略可） | 開いているメッセージ（題名、本文、ボタン）の一覧。`press` を渡すと最後のメッセージのそのボタンを押す |
| `setting` | `key`、`value` | 個人設定の値をこの起動の間だけ変える（ファイルには保存しない） |
| `event.select` | `kind`（`person` / `sign` / `warp` / `trap` / `fly`）、`index` | イベントを選ぶ |
| `event.mouse` | `action`（`click` / `drag` / `dblclick` / `hover`）、`x`、`y`、`toX`、`toY` | マップ上のマウス操作（座標はマス）。返事は選択（`hover` はステータスバー） |
| `event.state` | | 選択中の種別と番号、個数、表示中のマップのイベントと落とし物、最後に起動したスクリプトエディター |

イベントタブの部品の ID は `event.kind`、`event.number`、`event.cursor`、`event.remove`、`event.person.x` のような形です（`event.<種別>.<欄>`、イベントマネージャーは `event.manager.persons` と `event.manager.apply`）。

画面側の準備ができる前の要求には `{"ok":false,"error":"画面の準備ができていません"}` を返します。

## ライセンス

MIT（[LICENSE](LICENSE)）
