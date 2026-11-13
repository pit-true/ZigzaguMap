# 自動操作の入口（テスト用）

開発ビルドか、起動引数 `--automation <ポート>` を付けたときだけ、`127.0.0.1:<ポート>` で HTTP の POST を受け付けます（通常の起動では待ち受けません）。

- リリースの exe に付けたときは、操作を奪わないよう、メインも別ウィンドウも作った時点から画面外に置き、アクティブにせず、タスクバーにも出しません（見えない状態で作ってから画面外へ動かして表示する）。音も出しません（WebView2 に `--mute-audio` を付け、Windows 標準のメッセージボックスは出さない。画面内のダイアログは音を鳴らさない）。
- `--automation` を付けたときは、個人設定と WebView2 のデータを通常の場所（`%APPDATA%\io.github.pit-true.zigzagumap\`、`%LOCALAPPDATA%\io.github.pit-true.zigzagumap\EBWebView`）に置きません。`--profile <フォルダ>` を付ければそのフォルダ、付けなければ一時フォルダ（`%TEMP%\zigzagumap-profile-<プロセスID>`。終了時に消す）を使います。`state` の `profile` が使っているフォルダです。
- 確認作業でも比較テストでも、**`--profile` を必ず付けて**起動してください（設定を残したいときは同じフォルダを渡す）。
- 開発ビルドの既定のポート（17890）で起動したときは、`--automation` を付けていないので通常の個人設定を使います。

```sh
zigzagumap.exe --automation 17891 --profile C:\temp\zzm-profile
node scripts/automation-client.mjs 17891 '{"cmd":"state"}'
node scripts/automation-client.mjs 17891 '{"cmd":"screenshot"}' shot.png
```

確かめるスクリプト（`tests/automation`。ポート 17990〜17999 を使い、自分が起動したプロセスだけを終わらせる）:

```sh
python tests/automation/profile_check.py --rom <素の BPRJ> --exe <zigzagumap.exe>    # 通常の設定と WebView2 のデータが 1 バイトも変わらないこと
python tests/automation/offscreen_check.py --rom <素の BPRJ> --exe <zigzagumap.exe>  # どのウィンドウも画面内に出ず、前面にならないこと
```

本文は JSON 1 件で、返事は `{"ok":true,"result":...}` か `{"ok":false,"error":"..."}` です。

命令は分野ごとのファイル（`apps/desktop/src/app/automation/` の `core`・`fields`・`mouse`・`dialogs`・`menu`・`tree`・`images`・`status`・`events`）に分け、`index.ts` の 1 つの登録表にまとめています。`{"cmd":"commands"}` で登録されている命令の名前が出ます。自動操作の入口のコードは、自動操作で起動したときだけ読み込みます。

| cmd | 引数 | 動作 |
|---|---|---|
| `open` | `rom`、`project`（省略可） | ROM（とプロジェクトフォルダ）を開く。返事は `state` と同じ |
| `selectMap` | `bank`、`map` | マップを開く。返事の `switchMs` は切り替えにかかった時間 |
| `tab` | `name`（`map` / `movement` / `event` / `wild` / `header`） | タブを切り替える |
| `command` | `name`、`args` | CommandRegistry のコマンドを実行する（例: `{"cmd":"command","name":"paintBlocks","args":{"bank":3,"map":0,"cells":[{"x":5,"y":5,"block":9}]}}`） |
| `undo` / `redo` | | 元に戻す／やり直す |
| `export` | `dir`（素の ROM では必須） | 出力する。返事は書いたファイルと消したファイル |
| `selectBlock` | `block`、または `blocks` と `width` | 選択中のブロックの値を直接変える（パレットのクリックは `mouse` の `palette`） |
| `action` | `id` | メニューのアクションを ID で実行する（例: `view.grid`。有効かどうかは見ない） |
| `key` | `key`、`ctrl`・`alt`・`shift`、`id`（省略可） | キー操作をまねる（メニューの確認用）。`id` を付けるとその部品へ送る（トラックバーの PageUp など） |
| `mouse` | `target`（`map` / `movement` / `event` / `palette` / `border` / `movementPalette`）か `id`、位置は `cell: [x, y]`（マス。中央を押す）か `px: [x, y]`（部品の左上からの表示上の画素）、`action`（`click`（既定）/ `dblclick` / `rightClick` / `drag` / `hover` / `down` / `move` / `up`）、`drag` は `to: [x, y]`（マス）か `toPx` と `steps`（既定 8）、`button`（`left` / `right`）、`ctrl`、`shift` | マウス操作。実際のマウスは動かさず、部品へ pointer・mouse・click・dblclick・contextmenu の出来事を実際の操作と同じ順に送る（画面側は人の操作と同じ処理を通る）。拡大表示は設定から読む。返事は選択中のブロック・移動許可・イベントとステータスバー |
| `pointer`（別名） | `target`、`type`（`down` / `move` / `up`）、`x`・`y`（画素）、`button`、`ctrl`、`shift` | `mouse` の `action`・`px` と同じ（古い名前） |
| `event.mouse`（別名） | `action`（`click` / `drag` / `dblclick` / `hover`）、`x`、`y`、`toX`、`toY`（マス） | `mouse` の `target: "event"` と同じ（古い名前） |
| `selectMovement` | `value` | 移動許可の選択を変える（移動エリアタブなら、パレットのそのマスを左クリックするのと同じ） |
| `selection` | | 選択中のブロック（`block`）・移動許可（`movement`）・イベント（`event`: 種別・番号・数）とステータスバー |
| `getField` | `id` | 部品の状態。`id` はアプリ独自の ID（`data-auto-id`）か AdvanceMap の部品名（`field:Txt_PosX`）。返事は `value`（入力欄の文字、コンボは選んでいる項目の文字、チェックは true / false、ラベルは文字）、`enabled`、`visible`、`autoId`、`amName`、コンボなら `index` と `options`（64 件を超えるときは件数） |
| `setField` | `id`、`value` | 部品に値を入れ、人が入力したときと同じく `input` → `change` を送る。コンボは番号か項目の文字、チェックは true / false。返事は `getField` と同じものと、開いているダイアログ（`dialogs`） |
| `click` | `id` | ボタンなどを押す（無効なら失敗）。返事は開いているダイアログ |
| `ui.list` | `root`（省略可） | 部品の一覧（ID、AdvanceMap の部品名、値、有効か、表示されているか）。`root` に ID を渡すとその中だけ |
| `ui.type` | `id`、`text` | 1 文字ずつ入力する |
| `ui.shot` | `id` | 部品の範囲の画像を PNG（Base64）で返す（例: `event.panel` でイベントタブの右パネル） |
| `canvasPng` | `target`（`map` / `movement` / `event` / `palette` / `border` / `movementPalette`。古い形の `tab` も可。省略時は表示中のタブのマップ）か `id`（部品。`field:RandBox` など） | Canvas を PNG（Base64）で返す。マップは重ね描きとグリッド、ブロックパレットは選択の枠とグリッドを含む。表示の大きさ（拡大表示なら 2 倍）で、タブが隠れていても撮れる |
| `screenshot` | | ウィンドウ全体を PNG（Base64）で返す（PrintWindow で取るので前面に出さない） |
| `cells` | | 表示中のマップの配置とボーダーの値 |
| `state` | | 開いている ROM・プロジェクト・マップ、タブ、選択中のブロック、未出力のマップ、履歴の数、ステータスバー、ダイアログ、個人設定、`profile`、時間の記録、`jsHeap`（JavaScript のヒープ、MB） |
| `status` | | ステータスバーの各欄（`panels`: 画面に出ている文字列）と `left`・`right`・`error` |
| `title` | | 題名（`document`: ページの題名、`window`: ウィンドウの題名） |
| `dialogs` | | 開いているダイアログの一覧（開いた順。最後が手前）。画面内のダイアログ（`kind: "app"`。題名・本文・ボタン・入力欄の値・モーダルか）と、ファイル・フォルダを選ぶダイアログ（`kind: "native"`。種類・題名・ボタン・入力欄（選ぶパス）・種類の絞り込み・初めのフォルダ） |
| `dialog` | `input`、`press`（どちらも省略可）、`title`（省略時は手前のもの） | ダイアログに入力して、ボタンを押す（ボタンの文字列か `ok`・`yes`・`no`・`cancel`。`close` で ×）。ファイルのダイアログは `input` にパスを入れて `ok`（か「開く」「保存」）、`cancel` で取り消し。返事は押す前と後の一覧 |
| `queuePath` | `path`（null でキャンセル） | ファイル・フォルダを選ぶダイアログの答え。開いているダイアログがあればそれに答え（返事の `answered` が true）、無ければ次に出るダイアログの答えとして積む。自動操作のときは Windows のダイアログは一切出さず、答えが無ければ `dialogs` に出して待つ（Rust 側の `pick_*` も自動操作のときはダイアログを開かずにエラーを返す） |
| `menu.list` | | メニューの全項目（`path`: 階層の文言の列、`id`、`enabled`（親が無効なら無効）、`checked`、`submenu`、`shortcut`）。最近開いたものも含む。区切り線は出さない |
| `menu.run` | `path`（`"設定 > グリッドの表示"` か `["設定", "グリッドの表示"]`）か `id`、`wait`（ms、既定 100） | メニューの項目を実行する。メニューバーで選んだときと同じく、無効な項目とサブメニューは実行しない（失敗）。返事はステータスバーと開いているダイアログ |
| `tree.list` | `visibleOnly`（省略可） | マップ一覧の全項目（`text`: 未出力の印 ` *` を含む文字列、`depth`、`hasChildren`、`expanded`、`selected`、`opened`（開いているマップ）、`dirty`、`mapId`、`key`）。`visibleOnly: true` で開いている枝の中だけ |
| `tree.select` / `tree.open` | `key`、`text`、または `bank` と `map` | 項目を左クリック（選ぶだけ）／ダブルクリック（マップなら開いて開き終わるまで待つ、グループなら開閉）する。親が閉じていれば開いてから押す |
| `romInfo` | | 左下の ROM 情報（見出しと値の組） |
| `setting` | `key`、`value` | 個人設定の値をこの起動の間だけ変える（ファイルには保存しない） |
| `event.select` | `kind`（`person` / `sign` / `warp` / `trap` / `fly`）、`index` | イベントを選ぶ |
| `event.state` | | 選択中の種別と番号、個数、表示中のマップのイベントと落とし物、最後に起動したスクリプトエディター |
| `commands` | | 登録されている命令の名前 |
| `windows` | | 開いているウィンドウの一覧（`label`、`title`、`visible`、`ready`） |
| `exit` | | 確認なしで終了する |
| （ブロックエディタなど宛て） | `window`（`block-editor` / `palette-editor` / `block-adjust`）と各命令の引数 | `window` を付けると、そのウィンドウで命令を実行する（仕組みはワールドマップエディタと同じ。下の段落）。使える命令は `state`（欄の値）、`getField` / `setField` / `click`（`field:<AdvanceMap の部品名>` も可）、`ui.list` / `fields`、`action`（メニューの項目。ブロックエディタの `tiles.save1`・`blocks.amount`・`palette.commit` など）、`dialogs` / `dialog` / `queuePath`（メインと同じ）、`key`、`pointer`（`id` の部品の上。`x`・`y` は部品の左上から）、`canvasPng`（`id` の Canvas）、`snapshot`（メインから届いたタイルセットの写し）、`close`、`undo` / `redo`。`screenshot` も `window` で別ウィンドウを取れる。パレットエディタだけ `pickAt`（`source` のウィンドウの画像の `x`・`y` の色をスポイトで拾う） |

AdvanceMap の部品名（`field:<名前>`）は、`apps/desktop/src/app/automation/amNames.ts` の対応表（アプリ独自の ID → AdvanceMap の部品名。作業フォルダの inventory の部品表とフォーム定義から作った）から、自動操作の入口が動いているときだけ部品に `data-am-name` として付けます（通常の起動では付けない）。同じ名前の部品が複数あるときは表示中のものを使います。ワールドマップエディタは AdvanceMap の部品名を `data-auto-id` に使っているので、そのまま通ります。全画面の対応表（AdvanceMap の部品名 → ID）は `python tests/compare/gen_am_names.py --rom <素の BPRJ> --exe <zigzagumap.exe>` で実際の画面から集めて `tests/compare/am-names.json` に書きます。

イベントタブの部品の ID（`getField` / `setField` / `click` の `id`）は `event.kind`、`event.number`、`event.cursor`、`event.remove`、`event.person.x` のような形です（`event.<種別>.<欄>`、イベントマネージャーは `event.manager.persons` と `event.manager.apply`）。

部品の ID は `<場所>.<名前>` の形です（例: 場所の設定タブ `header.music`・`header.saveScripts`、高度な表示 `pro.footer`・`pro.saveFooter`、コネクションマネージャー `conn.direction`・`conn.save`・`conn.down1`、出現ポケモンタブ `wild.type`・`wild.rate`・`wild.rateBar`・`wild.min.1`・`wild.species.1`・`wild.save`、追加ダイアログ `wildAdd.0`〜`wildAdd.3`・`wildAdd.ok`、ブロックエディタ `be.blocks`・`be.tiles`・`be.block`・`be.palette`・`be.xflip`・`be.attr0`〜`be.attr3`・`be.behavior`・`be.save`、パレットエディタ `pal.color.0`〜`pal.color.15`・`pal.red`・`pal.hex`・`pal.apply`・`pal.pick`、一括変更 `adj.tileset2`・`adj.to.0`〜`adj.to.14`・`adj.save`、新しいマップ `newMap.name`・`newMap.width`・`newMap.tileset1`・`newMap.create`、マップの追加/挿入 `mapInsert.replaceBank`・`mapInsert.replaceMap`・`mapInsert.replace`・`mapInsert.countBank`・`mapInsert.count`・`mapInsert.countApply`、マップバンクヘッダー `bankHeader.remaining.<バンク>`・`bankHeader.newBank`・`bankHeader.apply`、マップタブの `map.makeMap`・`map.makeBank`、マップ一覧の根 `tree.root.h`・`tree.root.i`・`tree.root.f` と「マップファイル」の項目 `tree.mapFile.<番号>`（根と項目は `key` の `Enter` で開く）。一覧は各部品を作るコードの第 1 引数です。作業用のマップ（新規作成・`.map`。バンク -1）は `selectMap` では開けません（`action` の `tools.previousMap` で戻れます）。

## 別ウィンドウ（ワールドマップエディタ）

要求に `"window": "world-map"` を付けると、そのウィンドウへ送ります（`screenshot` に付けるとそのウィンドウを撮る）。`{"cmd":"windows"}` は開いているウィンドウの一覧（`label`、`title`、`visible`、`ready`）です。部品の ID は AdvanceMap の部品名（`Txt_Wert`、`Cbo_Wert_NamenListe`、`Txt_PosX`、`Cmd_NameSpeichern`、`Txt_FlugWert`、`Cmd_GotoFlugPos`、`Cbo_Anzahl`、`WorldmapBox` など。トップレイヤーは名前の後ろに `2`）です。

| cmd | 引数 | 動作 |
|---|---|---|
| `state` | | 読み込んだか、面、選んでいるマス、両レイヤーの値、マスの値、地名の位置と行き先、メインで開いているマップ、履歴の有無 |
| `fields` / `getField` | `id`（getField） | 部品の値（`value`・`checked`・`text`・`enabled`、コンボは `index` と `count`） |
| `setField` | `id`、`value` | 入力欄は文字列、チェックは true/false、コンボは番号か文字列。input と change を起こす |
| `click` | `id` | ボタンを押す。返事は開いているダイアログ |
| `pointer` | `id`、`type`（`down` / `move` / `up`）、`x`・`y`、`button` | 部品の左上からの位置でマウス操作をまねる（世界地図は 1 マス 8px、マス (0,0) が (32,32)） |
| `canvasPng` | `id`（`WorldmapBox`） | 世界地図の Canvas を PNG（Base64）で返す |
| `key` | `key`、`ctrl`・`alt`・`shift`、`id`（省略時はフォーカスのある部品） | キー操作をまねる |
| `dialog` | `input`、`press` | メインと同じ |

画面側の準備ができる前の要求には `{"ok":false,"error":"画面の準備ができていません"}` を返します。
