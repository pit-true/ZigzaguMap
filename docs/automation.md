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

確かめるスクリプト（`tests/automation`。ポート 17990〜17999 を使い（環境変数 `ZZM_PORTS=47810-47819` のように変えられる）、自分が起動したプロセスだけを終わらせる）:

```sh
python tests/automation/profile_check.py --rom <素の BPRJ> --exe <zigzagumap.exe>    # 通常の設定と WebView2 のデータが 1 バイトも変わらないこと
python tests/automation/offscreen_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--project <CFRU-JP のフォルダの写し>]
    # どのウィンドウも画面内に出ず、前面にならないこと（--project でスクリプトエディタも開く）
python tests/automation/script_editor_check.py --rom <素の BPRJ> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ> --exe <zigzagumap.exe> [--shots <フォルダ>]
    # スクリプトエディタ: 写しを作って開く・入力・保存（改行と BOM）・外部の変更の読み直し・開けないパス・未保存の確認
python tests/automation/process_check.py [--exe <zigzagumap.exe>]                  # 外部コマンドの出力・終了コード・停止と、ビルドの手順の copy
python tests/automation/script_theme_check.py --rom <素の BPRJ> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ> --exe <zigzagumap.exe> [--shots <フォルダ>]
    # スクリプトエディタのテーマ 4 つで、ウィンドウの部品（帯・検索の欄・補完・ホバー・ビルドの欄・波線の一覧・ダイアログ・スクロールバー）が同じテーマの色になること
python tests/automation/feedback_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>]
    # Phase1 のフィードバックで入れた動き（表示メニュー、透明度のスライダー、マップの外のイベントの帯、場所の設定のかんたん表示、
    # ROM を開いたあとのフォルダ選択、ヘルプ）を ZigzaguMap だけで確かめる。--shots で新しい画面のスクリーンショットを書く
python tests/automation/phase3_view_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>] [--only <名前> ...]
    # Phase3 の表示・ホバー・スタンプ（配置の共有など）。名前はスクリプトの CHECKS の鍵
python tests/automation/connection_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>] [--only 222,223]
    # Phase3 の接続と描画（issue ごとに起動し直して確かめる。--only で番号を選ぶ）
```

本文は JSON 1 件で、返事は `{"ok":true,"result":...}` か `{"ok":false,"error":"..."}` です。

命令は分野ごとのファイル（`apps/desktop/src/app/automation/` の `core`・`fields`・`mouse`・`dialogs`・`menu`・`tree`・`images`・`status`・`events`・`scripts`）に分け、`index.ts` の 1 つの登録表にまとめています。`{"cmd":"commands"}` で登録されている命令の名前が出ます。自動操作の入口のコードは、自動操作で起動したときだけ読み込みます。

| cmd | 引数 | 動作 |
|---|---|---|
| `open` | `rom`、`project`（省略可） | ROM（とプロジェクトフォルダ）を開く。返事は `state` と同じ |
| `selectMap` | `bank`、`map` | マップを開く。返事の `switchMs` は切り替えにかかった時間 |
| `tab` | `name`（`map` / `movement` / `event` / `wild` / `header`） | タブを切り替える |
| `command` | `name`、`args` | CommandRegistry のコマンドを実行する（例: `{"cmd":"command","name":"paintBlocks","args":{"bank":3,"map":0,"cells":[{"x":5,"y":5,"block":9}]}}`）。`group` の中や `targets` で 2 枚以上のマップを変えるときは、そのマップも先に読み込む。変わったマップには全部未出力の印が付く |
| `undo` / `redo` | | 元に戻す／やり直す |
| `export` | `dir`（素の ROM では必須） | 出力する。返事は書いたファイルと消したファイル |
| `selectBlock` | `block`、または `blocks` と `width` | 選択中のブロックの値を直接変える（パレットのクリックは `mouse` の `palette`） |
| `action` | `id` | メニューのアクションを ID で実行する（例: `view.grid`。有効かどうかは見ない） |
| `key` | `key`、`ctrl`・`alt`・`shift`、`id`（省略可）、`type`（省略可。`down` で押すだけ、`up` で離すだけ） | キー操作をまねる（メニューの確認用）。`id` を付けるとその部品へ送る（トラックバーの PageUp など）。Ctrl を押している間の表示（#238）は `{"cmd":"key","key":"Control","ctrl":true,"type":"down"}` で押し、`{"cmd":"key","key":"Control","type":"up"}` で離す |
| `mouse` | `target`（`map` / `movement` / `event` / `palette` / `border` / `movementPalette`）か `id`、位置は `cell: [x, y]`（マス。中央を押す）か `px: [x, y]`（部品の左上からの表示上の画素）、`action`（`click`（既定）/ `dblclick` / `rightClick` / `drag` / `hover` / `down` / `move` / `up`）、`drag` は `to: [x, y]`（マス）か `toPx` と `steps`（既定 8）、`button`（`left` / `right` / `middle` / `back` / `forward`。`back`・`forward` はサイドボタンで、マップの履歴を戻る・進む #237）、`ctrl`、`shift` | マウス操作。実際のマウスは動かさず、部品へ pointer・mouse・click・dblclick・contextmenu の出来事を実際の操作と同じ順に送る（画面側は人の操作と同じ処理を通る）。拡大表示は設定から読む。返事は選択中のブロック・移動許可・イベントとステータスバー |
| `pointer`（別名） | `target`、`type`（`down` / `move` / `up`）、`x`・`y`（画素）、`button`、`ctrl`、`shift` | `mouse` の `action`・`px` と同じ（古い名前） |
| `event.mouse`（別名） | `action`（`click` / `drag` / `dblclick` / `hover`）、`x`、`y`、`toX`、`toY`（マス） | `mouse` の `target: "event"` と同じ（古い名前） |
| `selectMovement` | `value` | 移動許可の選択を変える（移動エリアタブなら、パレットのそのマスを左クリックするのと同じ） |
| `selection` | | 選択中のブロック（`block`）・移動許可（`movement`）・イベント（`event`: 種別・番号・数）とステータスバー |
| `getField` | `id` | 部品の状態。`id` はアプリ独自の ID（`data-auto-id`）か AdvanceMap の部品名（`field:Txt_PosX`）。返事は `value`（入力欄の文字、コンボは選んでいる項目の文字、チェックは true / false、ラベルは文字）、`enabled`、`visible`、`autoId`、`amName`、コンボなら `index` と `options`（64 件を超えるときは件数）、入力欄なら `readOnly` と `focused`（フォーカスがあるか） |
| `setField` | `id`、`value` | 部品に値を入れ、人が入力したときと同じく `input` → `change` を送る。コンボは番号か項目の文字、チェックは true / false。返事は `getField` と同じものと、開いているダイアログ（`dialogs`） |
| `click` | `id` | ボタンなどを押す（無効なら失敗）。返事は開いているダイアログ |
| `ui.list` | `root`（省略可） | 部品の一覧（ID、AdvanceMap の部品名、値、有効か、表示されているか）。`root` に ID を渡すとその中だけ |
| `ui.type` | `id`、`text` | 1 文字ずつ入力する |
| `ui.shot` | `id` | 部品の範囲の画像を PNG（Base64）で返す（例: `event.panel` でイベントタブの右パネル）。スクロールする枠やウィンドウからはみ出す分は切り詰め、まったく見えていない部品はエラーを返す |
| `canvasPng` | `target`（`map` / `movement` / `event` / `palette` / `border` / `movementPalette`。古い形の `tab` も可。省略時は表示中のタブのマップ）か `id`（部品。`field:RandBox` など） | Canvas を PNG（Base64）で返す。マップは重ね描きとグリッド、ブロックパレットは選択の枠とグリッドを含む。表示の大きさ（拡大表示なら 2 倍）で、タブが隠れていても撮れる |
| `screenshot` | | ウィンドウ全体を PNG（Base64）で返す（PrintWindow で取るので前面に出さない） |
| `cells` | | 表示中のマップの配置とボーダーの値 |
| `state` | | 開いている ROM・プロジェクト・マップ、タブ、選択中のブロック、未出力のマップ、履歴の数、ステータスバー、ダイアログ、個人設定、`profile`、時間の記録、`jsHeap`（JavaScript のヒープ、MB）、`openedUrls`（ヘルプのリンクなどで開こうとした外部の URL。新しい順。自動操作のときはブラウザを開かない） |
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
| `setting` | `key`、`value` | 個人設定の値をこの起動の間だけ変える（ファイルには保存しない）。`theme`（`light` / `dark`）はすぐ画面と開いている別ウィンドウに当てる（メニューの 設定 > テーマ と同じ。`menu.list` の `theme.light`・`theme.dark` の `checked` も変わる） |
| `event.select` | `kind`（`person` / `sign` / `warp` / `trap` / `fly`）、`index` | イベントを選ぶ |
| `event.state` | | 選択中の種別と番号、個数、表示中のマップのイベントと落とし物、`warpWarnings`（ワープできないブロックの上にあるワープの番号。#240） |
| `event.deletePlan` | `kind`（`person` / `sign` / `warp` / `trap`）、`index` | イベントの削除（#220）で消すものの計画（何も変えない）。`label`・`pointer`、`script`（`.s` の `scriptPath`・`removedLabels`・`keptLabels`（`label`・`reason`・`where`）・`removedStrings`・`keptStrings`）、`registry`（幅検査の登録から除く名前）、`rom`（`erase`・`keep`（`address`・`length`・`type`・`label`、`keep` は `reason`）・`problems`）、`romNote`（`outside` / `noProject` / `broken`）、書き換える `files`、確認のダイアログの行 `lines` |
| `event.delete` | `kind`、`index`、`confirm`（省略で true） | イベントを選んで削除する（ボタン・右クリック・Delete キーと同じ）。true なら確認のダイアログ「イベントを削除」を出したまま返す（`dialog` で「削除」（`ok`）か「キャンセル」を押す）。false なら確かめずに消し、書き足しが済むまで待つ（返事は `ok`・`status`・`selection`・`counts`） |
| `contextMenu.state` | | 開いている右クリックのメニュー（`items`: `id`・`label`・`enabled`）。無ければ null。イベントタブのマップは `mouse` の `rightClick` で開く（項目 `delete`「イベントを削除」と `openScript`「スクリプトを開く」） |
| `contextMenu.press` | `id`（項目の `id` か文字列） | メニューの項目を押す。返事は開いているダイアログとステータスバー |
| `romErase.state` | | `maps\rom_erase.json` の範囲（`ranges`: `address`・`length`・`type`・`bank`・`map`・`event`・`index`）、未出力の変更 `modified`、読めなかった理由 `loadError` |
| `commands` | | 登録されている命令の名前 |
| `windows` | | 開いているウィンドウの一覧（`label`、`title`、`visible`、`ready`） |
| `exit` | | 確認なしで終了する |
| `process.run` | `command`、`args`（文字列の配列）、`cwd`（プロジェクトフォルダからの相対パスか絶対パス。省略時はプロジェクトフォルダ）、`timeout`（ms、既定 30000） | 外部コマンドを動かして終わるまで待つ。返事は `id`・`cwd`（作業フォルダの絶対パス）・`lines`（`stream` と `line`）・`done`・`code`（終了コード）・`killed`。時間を過ぎたら止めて `timedOut: true` を付ける |
| `process.start` / `process.output` / `process.kill` | `process.start` は `process.run` と同じ引数、ほかは `id` | 待たずに起動して `id` を返す／それまでの出力と状態（返事は `process.run` と同じ形）／止める（子プロセスごと） |
| `process.copy` | `from`、`to`、`cwd` | ファイルを写す（ビルドの手順の `copy` と同じ。`from`・`to` は `cwd` からの相対パス）。返事の `bytes` は写した大きさ |
| `script.open` | `path`（と `line`、1 から）か、`bank`・`map`・`kind`（`person` / `sign` / `trap` / `map`）・`index`（0 から） | スクリプトエディタでファイルかイベントのスクリプトを開く（イベントのダブルクリックと同じ）。返事は `opened`、イベントなら `location`（`path`・`line`・`label`・`from`）、ステータスバー。ウィンドウの準備は `windows` の `ready` で待つ |
| `script.resolve` | `bank`・`map`・`kind`・`index` | イベントのスクリプトの場所（`path`・`line`・`label`・`from`: `label` か `scriptsJson`）。見つからなければ null。開かない |
| `scripts.table` | `action`（省略で `get`）と、その引数（下の表） | maps\scripts.json の対応表（ツール > スクリプトファイルの対応表）。返事は `rows`（各行の `bank`・`map`（null はバンク全体）・`name`・`script`・`strings`（省いていれば null）・`resolvedStrings`（実際に使う `.string`）・`create`（出力で `.s` を作る行）・`unused`（前の行と同じバンク・マップで使われない行））、`pendingFiles`（出力で作る `.s` と `.string`）、`duplicates`、`modified`（未出力の変更）、`loadError`（scripts.json が読めなかった理由）、`open`（画面が開いているか）、`selected`（選んでいる行）、`dialogs` |
| `script.labels` | `bank`・`map`（省略で表示中のマップ） | マップのイベントのラベル（#200・#204）。`person`・`sign`・`tile`（それぞれ `index`・`label`・`kind`・`inScript`（マップの `.s` にあるか））、`mapScripts`（eventscripts の `map` の行のラベル）、`table`（ZigzaguMap が `.s` に書くマップスクリプトの表）、`script`・`strings`（マップの `.s` と `.string`）、`candidates`（`.s` のラベルの一覧）、`hasFile`（scripts_MM.json があるか）、`conditional`（`#ifdef` の中の行）、`mismatches`（照合用の座標と合わないラベル）、`modified` |
| `script.setLabel` | `bank`・`map`（省略可）、`target`（`person` / `sign` / `tile` / `map`）、`index`、`label`（null で外す）、`kind`（人の `npc` / `trainer` / `item`） | ラベルを変える（`setEventLabel` を CommandBus で実行。元に戻せる）。返事は `script.labels` と同じ |
| `script.realign` | `bank`・`map`（省略可） | 照合用の座標と合わないラベルを、書いた座標にあるイベントへ付け替える（「座標で付け直す」と同じ） |
| `script.settle` | | ひな形・取り込みなどの書き足し（`.s` と `.string`）が済むまで待つ |
| `script.rom` | `bank`・`map`・`kind`（`person` / `sign` / `trap` / `map`）・`index` か `pointer`（両方渡すと `pointer` のスクリプトを、そのイベントのものとして出す） | 素の ROM のスクリプトを、エディタの読み取り専用のタブで開く（#206）。返事は `opened`・`tab`（`ROM:08XXXXXX`）・`text`（表示した文）・`importable`・`items`（取り込むときの名前）。`kind` が `map` なら、`pointer` がマップスクリプトの表の行き先のときだけ `importable` になる |
| `script.import` | `script.rom` と同じ、`rename`（自動で付けた名前 → 新しい名前） | ROM のスクリプトを `.s` に取り込み、イベントのラベルを取り込んだ入口にする（#207。元に戻せる）。`kind` が `map` なら、マップスクリプトの表で行き先が `pointer` の件を入口のラベル（`<表のラベル>_<種類>`）に付け替える（表が無ければ「表を作る」と同じ表を作ってから。返事の `table` が新しい表）。返事は取り込みの計画（`entryLabel`・`reused`・`items`・`asm`・`strings`・`blocks`（まとまりの `label`・`offset`・`size`・`pointers`）・`problems`） |
| `script.mapScripts` | `action`（`get` / `create` / `add`（`type`）/ `addCondition`（`index`）/ `set`（`table`）/ `remove`） | 場所の設定タブのかんたん表示のマップスクリプトのパネル（#208。先に `tab` で `header` を開く）。返事は `ok`・`table`・`labels`（`script.labels`）・ステータスバー |
| `scroll` | `target`（`map` / `movement` / `event` / `palette` / `movementPalette`）か `id`、`to`（`end` で右下の端、`start` で左上）・`x`・`y`（位置、px）・`dx`・`dy`（今の位置からの量、px）のどれか | 部品を載せたスクロールの枠を動かす（スクロールバーを動かしたときと同じく `scroll` の出来事を起こす）。返事は `view.scroll` と同じ |
| `view.scroll` | `target` か `id` | スクロールの状態。`h`・`v`（横・縦のスクロールバーが出ていて使えるか）、`inside`（枠がウィンドウに収まっているか）、`scrollLeft`・`scrollTop`・`scrollWidth`・`scrollHeight`・`clientWidth`・`clientHeight` |
| `splitter` | `width`（px） | 左の欄（マップ一覧）の幅を変える。分割バーをドラッグして離したときと同じ処理（120 以上、ウィンドウの幅 - 300 以下に丸め、個人設定に残す）。返事は決まった幅 |
| `resize` | `width`、`height`（論理ピクセル） | メインウィンドウの大きさを変える。返事は中の大きさ |
| `drop` | `paths`（パスの配列）か `path` | ファイル・フォルダのドラッグ＆ドロップと同じ処理で開く（先頭の 1 つ。フォルダならプロジェクト、`.gba` なら ROM、ほかはステータスバーに案内）。`.gba` は続けて組のフォルダを選ぶダイアログが出るので、ダイアログが出たところで返る（`queuePath` で答え、`null` でキャンセルすると ROM だけで開く）。返事は開いている ROM・プロジェクト、ステータスバー、開いているダイアログ |
| （ブロックエディタなど宛て） | `window`（`block-editor` / `palette-editor` / `block-adjust`）と各命令の引数 | `window` を付けると、そのウィンドウで命令を実行する（仕組みはワールドマップエディタと同じ。下の段落）。使える命令は `state`（欄の値）、`getField` / `setField` / `click`（`field:<AdvanceMap の部品名>` も可）、`ui.list` / `fields`、`action`（メニューの項目。ブロックエディタの `tiles.save1`・`blocks.amount`・`palette.commit` など）、`dialogs` / `dialog` / `queuePath`（メインと同じ）、`key`、`pointer`（`id` の部品の上。`x`・`y` は部品の左上から）、`canvasPng`（`id` の Canvas）、`snapshot`（メインから届いたタイルセットの写し）、`scroll` / `view.scroll`（`id` の部品の枠。ブロック一覧は `be.blocks`、引数はメインと同じ）、`close`、`undo` / `redo`。`screenshot` も `window` で別ウィンドウを取れる。パレットエディタだけ `pickAt`（`source` のウィンドウの画像の `x`・`y` の色をスポイトで拾う） |

AdvanceMap の部品名（`field:<名前>`）は、`apps/desktop/src/app/automation/amNames.ts` の対応表（アプリ独自の ID → AdvanceMap の部品名。作業フォルダの inventory の部品表とフォーム定義から作った）から、自動操作の入口が動いているときだけ部品に `data-am-name` として付けます（通常の起動では付けない）。同じ名前の部品が複数あるときは表示中のものを使います。ワールドマップエディタは AdvanceMap の部品名を `data-auto-id` に使っているので、そのまま通ります。全画面の対応表（AdvanceMap の部品名 → ID）は `python tests/compare/gen_am_names.py --rom <素の BPRJ> --exe <zigzagumap.exe>` で実際の画面から集めて `tests/compare/am-names.json` に書きます。

ROM を開くメニュー・ツールバー・ドラッグ＆ドロップ・組のフォルダが記録されていない最近開いたものでは、ROM を選んだあとに組のフォルダを選ぶダイアログ（`dialogs` の `kind: "native"`、`type: "folder"`）が出ます。`queuePath` にフォルダか `null`（キャンセル。ROM だけで開く）を渡します。`open` 命令はダイアログを出さずに、渡した ROM とプロジェクトで開きます。

Phase1 のフィードバックで足した部品の ID: 透明度のスライダー `view.opacity.slider`（`setField` に 0〜100）・`view.opacity.value`（「30%」）・`view.opacity.close`、マップの外のイベントの帯 `outside.bar`（`getField` の `visible`）・`outside.fix`（マップの内側に戻す）、場所の設定タブの切り替え `header.mode.simple`・`header.mode.classic`（`click`）・`header.advanced`（高度なヘッダーを表示）、かんたん表示 `easy.region`・`easy.newName`・`easy.rename`・`easy.showName`・`easy.music`・`easy.musicNo`・`easy.weather`・`easy.mapType`・`easy.battleType`・`easy.cave`・`easy.bike`・`easy.run`・`easy.escape`・`easy.tileset1`・`easy.tileset2`・`easy.changeTilesets`・`easy.width`・`easy.height`・`easy.resize`・`easy.borderWidth`・`easy.borderHeight`・`easy.resizeBorder`・`easy.connections`・`easy.openConnections`（マップスクリプトは `easy.scriptNo` など、くわしく表示の `header.` を `easy.` にしたもの）、ヘルプの文書の窓 `help.doc`（開いている文書のパス。画面には出さず、`getField` の `value` で読む）・`help.content`（本文。`view.scroll` の `id` に使える）・`help.home`（リンクで別の文書へ移ったときに本文の先頭に出す「← Read meに戻る」。元の文書の離れた位置へ戻る。#219 で「戻る」ボタン `help.back` の代わりにした）・`help.close`・本文のリンク `help.link:<行き先>`（`help.link:#ショートカット`、`help.link:docs/automation.md` など。`click` で押す）、バージョン情報 `about.version`・`about.link`。

イベントの削除の確認のダイアログの部品の ID は `eventDelete.list`（消すものの一覧）・`eventDelete.ok`・`eventDelete.cancel`、右クリックのメニューは `contextMenu` と `contextMenu.<項目の id>` です。

イベントタブの部品の ID（`getField` / `setField` / `click` の `id`）は `event.kind`、`event.number`、`event.cursor`、`event.remove`、`event.person.x` のような形です（`event.<種別>.<欄>`、イベントマネージャーは `event.manager.persons` と `event.manager.apply`）。

部品の ID は `<場所>.<名前>` の形です（例: 場所の設定タブ `header.music`・`header.saveScripts`、高度な表示 `pro.footer`・`pro.saveFooter`、コネクションマネージャー `conn.direction`・`conn.save`・`conn.down1`、出現ポケモンタブ `wild.type`・`wild.rate`・`wild.rateBar`・`wild.min.1`・`wild.species.1`・`wild.save`、追加ダイアログ `wildAdd.0`〜`wildAdd.3`・`wildAdd.ok`、ブロックエディタ `be.blocks`・`be.tiles`・`be.block`・`be.palette`・`be.xflip`・`be.attr0`〜`be.attr3`・`be.behavior`・`be.save`、パレットエディタ `pal.color.0`〜`pal.color.15`・`pal.red`・`pal.hex`・`pal.apply`・`pal.pick`、一括変更 `adj.tileset2`・`adj.to.0`〜`adj.to.14`・`adj.save`、新しいマップ `newMap.name`・`newMap.width`・`newMap.tileset1`・`newMap.create`、マップの追加/挿入 `mapInsert.replaceBank`・`mapInsert.replaceMap`・`mapInsert.replace`・`mapInsert.countBank`・`mapInsert.count`・`mapInsert.countApply`、マップバンクヘッダー `bankHeader.remaining.<バンク>`・`bankHeader.newBank`・`bankHeader.apply`、マップタブの `map.makeMap`・`map.makeBank`、マップ一覧の根 `tree.root.h`・`tree.root.i`・`tree.root.f` と「マップファイル」の項目 `tree.mapFile.<番号>`（根と項目は `key` の `Enter` で開く）。一覧は各部品を作るコードの第 1 引数です。作業用のマップ（新規作成・`.map`。バンク -1）は `selectMap` では開けません（`action` の `tools.previousMap` で戻れます）。

`scripts.table` の `action`:

| action | 引数 | 動作 |
|---|---|---|
| `get` | | 対応表を読むだけ |
| `open` / `close` | | 画面を開く／閉じる（メニューの `tools.scriptsTable` と同じ。CFRU-JP のフォルダが無ければ案内のダイアログを出す） |
| `select` | `index` | 画面で行を選び、下の欄に入れる（行のクリックと同じ） |
| `add` | `entry`（`bank`・`map`・`name`・`script`・`strings`）、`index`（入れる位置。省略で末尾）、`create`（true で出力のときに `.s` と `.string` を作る） | 行を足す（コマンド `addScriptsTableEntry`） |
| `set` | `index`、`entry` | 行を書き換える（`setScriptsTableEntry`。知らない項目と `create` は残す） |
| `remove` | `index` | 行を消す（`removeScriptsTableEntry`。ファイルは消さない） |
| `move` | `index`、`to` | 行を動かす（`moveScriptsTableEntry`） |
| `resolve` | `bank`、`map` | そのマップのスクリプトを書く `.s` と `.string`（`entry`・`entryIndex`・`script`・`strings`）。無ければ null |
| `newScript` | `bank`・`map`・`fileName`（どれも省略可） | 「.s を新しく作る」の入力を出す（答えを待たずに返す。`setField` と `click`、または `dialog` で答える） |
| `ensure` | `bank`、`map` | 対応表にあれば `resolved` に返し、無ければ「.s を新しく作る」の入力を出す（イベントを置いたときと同じ。待たずに返し、`resolved` は null） |

編集（`add` など）は `command` 命令（`{"cmd":"command","name":"addScriptsTableEntry","args":{"entry":{...}}}`）でも同じです。誤った入力（範囲外のバンク、`..` や絶対パス、拡張子の違い、新しく作るファイルの名前に使えない字、行の番号の範囲外）はエラーになり、表は変わりません。

対応表の画面の部品の ID: 表 `scriptsTable.list`・行 `scriptsTable.row.<番号>`（`click` で選ぶ）、下の欄 `scriptsTable.bank`・`scriptsTable.map`・`scriptsTable.name`・`scriptsTable.script`・`scriptsTable.strings`、ボタン `scriptsTable.newScript`・`scriptsTable.add`・`scriptsTable.save`・`scriptsTable.remove`・`scriptsTable.up`・`scriptsTable.down`・`scriptsTable.close`、警告 `scriptsTable.warning`、案内 `scriptsTable.note`。「.s を新しく作る」の入力は `scriptsTable.new.name`（ファイル名）・`scriptsTable.new.bank`・`scriptsTable.new.map`・`scriptsTable.new.mapName`・`scriptsTable.new.strings`・`scriptsTable.new.preview`（作るファイル）・`scriptsTable.new.intro`・`scriptsTable.new.create`・`scriptsTable.new.cancel` です。

確かめるスクリプト `python tests/automation/scripts_table_check.py --nd <NeoDark-CFRU-main> --chronos <Chronos> --copy-root <写し先> [--exe <zigzagumap.exe>] [--shot <png>]` は、ND と Chronos のフォルダを写し先へ写して（実フォルダには書かない）、画面と `scripts.table` で表を編集し、出力・開き直し・写しでのビルドまでを確かめます。

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
| `close` | | ウィンドウを閉じる（× を押したときと同じ） |

画面側の準備ができる前の要求には `{"ok":false,"error":"画面の準備ができていません"}` を返します。

## 別ウィンドウ（スクリプトエディタ）

要求に `"window": "script-editor"` を付けると、スクリプトエディタのウィンドウへ送ります（`screenshot` も同じ）。ウィンドウはメインの `script.open` で開きます。行と桁は 1 から、`offset` は本文の先頭からの文字の位置（0 から。改行は 1 文字）です。

| cmd | 引数 | 動作 |
|---|---|---|
| `state` / `editor.state` | | タブ（`path`・`kind`（`asm` / `string`）・`dirty`・`missing`・`lineEnding`・`bom`・`lines`）、表示中のファイル `active`、`dirty`、カーソル `cursor`（`line`・`column`・`offset`）、選択 `selection`（範囲ごとの `anchor`・`head`・`text`）、下の帯のお知らせ `message`、題名 `title`、開いているダイアログ `dialogs` |
| `editor.open` | `path`、`line`（省略可） | ファイルを開く（開いていればそのタブへ）。開けないパスならエラーのダイアログを出したまま返す（返事の `opened` が false） |
| `editor.text` | `path`（省略で表示中のもの） | 本文（改行は `
`） |
| `editor.setText` | `text` | 表示中のファイルの本文を全部置き換える（履歴に入る） |
| `editor.select` | `line`・`column` か `offset`（始まり）、`toLine`・`toColumn` か `toOffset`（終わり。省略でカーソルだけ） | 選択を変える |
| `editor.type` | `text`、`line`・`column` か `offset`（省略で今のカーソル） | 文字を入力する（選択と置き換える。キーで入力したときと同じ取引で、IME は通さない） |
| `editor.key` | `key`、`ctrl`・`alt`・`shift` | 本文へキーを送る（Ctrl+S・Ctrl+Z・Enter など、エディタのキーの割り当てを通る）。`key` も同じ |
| `editor.save` | | 表示中のファイルを保存する（返事の `saved`） |
| `editor.activate` | `path` | タブを切り替える |
| `editor.closeTab` | `path`（省略で表示中のもの） | タブを閉じる。未保存なら確認のダイアログを出したまま返す |
| `editor.checkExternal` | | 1 秒ごとの見張りを待たずに、外部の変更を調べる |
| `editor.project` | `wait`（省略で true） | 命令表と索引の読み込みを待ち、読み込みの結果（`loaded`・`loadMs`・`dialect`・命令・ラベル・`.equ`・文字列のラベルの数、`problems`）を返す |
| `editor.tokens` | `line`、または `fromLine`・`toLine`（省略で全部） | 行ごとの字句の種類 `syntax`（`comment`・`labelDef`・`directive`・`number`・`string`・`macroArg`・`escape`・`placeholder`・`special`・`rawBytes`・`meta`）と、命令表で決めた種類 `semantic`（`command`・`instruction`・`unknownCommand`・`textRef`・`labelRef`・`variable`・`constant`）。どれも `text`・`column`・`kind` |
| `editor.theme` | `theme`（省略で今のまま。`darkPlus` / `lightPlus` / `monokai` / `solarizedDark`） | テーマを変える（個人設定に残す）。返事は `theme`・`themes`・色の表 `palette`（本文の `code` とウィンドウの部品の `ui`）・本文で実際に出ている色 `rendered`（種類ごと、`comment`・`labelDef`・`background`）・ウィンドウの部品で実際に出ている色 `ui`（部品ごとの `background`（透明なら親の地）・`color`・`border`。出ていない部品は null。部品は `page`・`tabBar`・`tab`・`activeTab`・`statusBar`・`themeSelect`・`romBar`・`buildPanel`・`buildButton`・`buildLog`・`buildProblems`・`searchPanel`・`searchField`・`searchButton`・`lintPanel`・`tooltip`・`completion`・`completionSelected`・`dialog`・`dialogBody`・`dialogButton`・`dialogInput`、`scrollbar` は `background` に `scrollbar-color` の値） |
| `editor.hover` | `line`・`column` か `offset`、`show`（true で吹き出しを出したままにする） | その位置のホバー（`type`（`command`・`string`・`stringEqu`・`label`・`value`）、範囲 `from`・`to`・`text`、`markdown`、記号を外した `plain`）。出すものが無ければ null |
| `editor.closeHover` | | `show` で出した吹き出し（と文字列の入力欄）を閉じる |
| `editor.complete` | `line`・`column` か `offset`、`filter`（省略で打った分）、`limit`（既定 50）、`show`（true で候補の窓を出す） | その位置の補完（`context`（`op` / `argument`）、`argIndex`、引数の種類 `kind`、置き換える範囲 `from`・`to`、`word`、候補の総数 `total`、絞った数 `count`、候補 `items`（`label`・`type`・`detail`）） |
| `editor.definition` | `line`・`column` か `offset`、`go`（true で移動する） | その位置の名前の定義（`definition` の `kind`（`label`・`string`・`equ`・`macro`）・`name`・`targets`（`path`・`line`））。`go` なら移動して、`moved`・`active`・`cursor`・戻る履歴の数 `back`・下の帯の `message` |
| `editor.back` | | 定義へ移動する前の位置へ戻る（Alt+← と同じ） |
| `editor.search` | `query`・`replace`・`regexp`・`caseSensitive`・`wholeWord`（省略で前の値）、`action`（`find`（既定）・`next`・`previous`・`replace`・`replaceAll`・`selectAll`・`close`） | 検索の欄を開いて条件を入れ、`action` を行う。返事は一致の一覧 `matches`（`line`・`column`・`text`。500 件まで）、`count`、`selection`、`dirty`。`replace` は、選んでいる一致を置き換えて次を選ぶ（一致を選んでいなければ、次の一致を選ぶだけ。置換の欄のボタンと同じ） |
| `editor.select`（広げたもの） | 上の 1 つの範囲に加えて、`add`（true で今の選択に足す）、`ranges`（範囲の配列）、`rect`（`line`・`column`・`toLine`・`toColumn` の矩形） | 複数の範囲・矩形の選択 |
| `editor.command` | `name`（`moveLineUp`・`moveLineDown`・`copyLineUp`・`copyLineDown`・`toggleComment`・`selectNextOccurrence`・`selectSelectionMatches`・`addCursorAbove`・`addCursorBelow`・`undo`・`redo`・`startCompletion`・`openLintPanel`・`closeLintPanel`） | エディタの操作を実行し、本文 `text` と `selection` を返す |
| `editor.mouse` | `line`・`column`、`toLine`・`toColumn`（あればドラッグ）、`ctrl`・`alt`・`shift` | 本文の位置でマウスを押す（Ctrl+クリックの定義へ移動・カーソルを足す、Alt+ドラッグの矩形選択） |
| `editor.perf` | `line`・`column`、`count`（既定 30） | その位置で 1 字ずつ打ち、画面の更新（次のフレーム）までの時間を測る（`averageMs`・`maxMs`・`lines`）。打った字は消し、履歴にも残さない |
| `editor.diagnostics` | | 波線を調べ直して、表示中のファイルの波線（`line`・`column`・`severity`・`source`（`unknownCommand` などの種類か、外から足したものの出どころ）・`message`・`text`）を返す |
| `editor.widthCheck` | `wait`（true で、動いている検査が終わるまで待つ） | 保存時の幅検査の結果。`busy`、動かした回数 `runs`、最後の結果 `last`（`path`・終了コード `exit`・拾った誤り `errors`（`path`・`line`・`label`・`message`）・登録ファイルへの書き足し `registry`（`path`・`added`・`unresolved`・`removed`・登録の無いファイルなら `notChecked`）・`failed`）、出力の最後の 200 行 `log` |
| `editor.stringEdit` | `label`・`text`、または `line`・`column`・`label`・`open`（true で入力欄を出す） | 文字列のラベルの本文を差し替える（`text` の改行は `
` などの制御記号のすぐ後ろにだけ書け、そこで `.string` の行を分ける。#221）（`.string` のタブを未保存にする。開いていなければ裏で開く）。返事は `path`・`dirty`・`tabs`。`open` なら、ホバーの「本文を編集」と同じ入力欄を出す |

| `build.run` | `wait`（true で終わるまで待つ）、`confirm`（false で保存・出力の確認を飛ばす） | ビルドの欄でビルドする（ツール > ビルドと同じ。#198）。返事は `build.state` と開いているダイアログ |
| `build.state` | | `running`・`step`（今の手順、0 から）・`steps`（手順の列）・`result`（`ok`・`code`・`killed`・`failedStep`・`ms`）・`problems`（拾ったエラー。`kind`・`severity`・`message`・`path`・`line`・`symbol`・`logLine`）・`lines`（ログの行数）・`outputRom` |
| `build.log` | `from`（省略で 0） | ログの行（`stream`（`stdout` / `stderr` / `info`）・`line`・`step`） |
| `build.stop` | | ビルドを止める（子プロセスごと） |
| `editor.import` | `key`（省略で表示中の ROM のタブ）、`rename` | ROM のタブを取り込む（「.s に取り込む」と同じ。#207。マップスクリプトの「見る」で開いたタブも）。`rename` を渡さなければ名前の一覧のダイアログを出したまま返す（`dialog` で「取り込む」を押す） |
| `editor.rename` | `from`、`to`（省略で名前を聞くダイアログを出す） | ラベル名を変える（F2 と同じ。#203）。返事の `result` は `count`（変えた数）・`files`・`uses`（メインで変えたイベントの数） |
| `close` | | × と同じ。未保存が無ければ閉じる（返事の `closing` が true）。あれば確認のダイアログを出したまま返す |
| `dialogs` / `dialog` | メインと同じ | 画面内のダイアログを読む・押す（「保存しますか？」は `yes` / `no` / `cancel`、「読み直しますか？」は `yes` / `no`） |

`editor.state` には、表示中のファイルの波線 `diagnostics`（`editor.diagnostics` と同じ形）と、今のテーマ `theme` も入ります。

### スクリプト連携の部品の ID

- イベントタブのスクリプトのラベルの欄: `event.person.label`・`event.sign.label`・`event.trap.label`（入力欄）、`<欄>.drop`（▼）、`<欄>.list`（一覧）、`<欄>.option:<ラベル>`（一覧の行）。「スクリプトを開く」は `event.person.openScript` など。照合用の座標の知らせは `event.labelWarn`、「座標で付け直す」は `event.labelRealign`。
- マップスクリプトのパネル（場所の設定タブのかんたん表示）: `easy.ms`（パネル）、`easy.ms.create`（表を作る）、`easy.ms.addType`（種類を足す）、`easy.ms.removeTable`、`easy.ms.item:<n>`、`easy.ms.item:<n>.script`（行き先のラベルの欄）、`easy.ms.item:<n>.open`・`.remove`・`.addCondition`、`easy.ms.item:<n>.condition:<m>.variable`・`.value`・`.script`・`.open`・`.remove`、ROM の一覧は `easy.ms.rom:<n>` と `easy.ms.romOpen:<n>`。
- スクリプトエディタ: ROM のタブの帯 `se.romBar`、「.s に取り込む」`se.romImport`、取り込みの一覧の名前 `romImport.label:<n>`、`romImport.ok`・`romImport.cancel`。ビルドの欄 `build.panel`、`build.run`・`build.stop`・`build.clear`・`build.close`、`build.status`、`build.log`、`build.problems`、`build.problem:<n>`。

## Phase3 の部品と命令（表示・ホバー・スタンプ）

- 場所の設定タブの「配置の共有」（#228）: かんたん表示 `easy.layoutShared`（「この配置（ブロックの並び）は N 枚のマップで使われています」の文。共有していないマップでは `visible` が false）・一覧 `easy.layoutShared.list`・一覧のマップ `easy.layoutShared.map:<バンク>.<マップ>`（`click` で開く。表示中のマップはボタンにしない）。くわしく表示は頭が `header.`（`header.layoutShared` など）。

| cmd | 引数 | 動作 |
|---|---|---|
| `event.hover` | `kind`（`person` / `sign` / `warp` / `trap`）・`index`、または `cell: [x, y]`、`show`（false で返したあと消す。既定 true） | イベントタブ（先に `tab` で `event`）のそのマスの吹き出し（#226）を待たずに出し、中身ができるまで待って返す。返事は `shown`（出したか。イベントが無ければ false）、`visible`、`cell`、`sections`（イベントごとの `title`・`lines`・`warn`・`image`（画像があるか））、`text`（全部の行を改行でつないだもの） |
| `event.hover.state` | | 今出している吹き出し（返事は `event.hover` と同じ形）。マウスの `hover` で 0.4 秒止めたあとに読む |
| `event.hover.hide` | | 吹き出しを消す |

吹き出しの部品の ID は `event.hover`（`ui.shot` で撮れる）です。ワープの吹き出しは行き先の周辺画像（`sections[].image` が true）と、ワープできないブロックの上なら `warn`（「このブロックではワープできません…」）を持ちます（#240）。

| cmd | 引数 | 動作 |
|---|---|---|
| `history.state` | | マップの履歴（#237）。`current`（表示中のマップ）、`back`（戻る先。古い順で、最後が 1 つ前）、`forward`（進む先。最後がいちばん先）、`canBack`・`canForward` |
| `mapFind` | `query`、`open`（true で先頭の候補を開く） | マップ名で探す（#237。ツール > マップ名で探して開く と同じ探し方）。返事は `candidates`（`id`・`name`・`text`、50 件まで）と、開いたマップ `opened` |
| `tree.filter` | `text`（空で消す） | マップ一覧の絞り込みの欄に入れる（入力したときと同じ）。返事は `filter` と項目の数 `items`。絞り込んだ一覧は `tree.list` で読む |

- 戻る・進むは `action` の `view.back`・`view.forward`（`tools.previousMap` も戻る）。マウスのサイドボタンは `mouse` の `button: "back"` / `"forward"`（`click`。どの部品の上でもよい）。
- マップ名で探して開く窓（`action` の `map.find`、Ctrl+F）: 題名「マップ名で探して開く」、入力欄 `mapFind.input`（`setField` で入れると候補を作り直す）、候補の一覧 `mapFind.list`・候補 `mapFind.item:<バンク>.<マップ>`、`dialog` の `press` は `ok`（先頭か選んだ候補を開く）・`cancel`。
- マップ一覧の絞り込みの欄 `tree.filter`、× のボタン `tree.filterClear`。

- Ctrl を押している間（#238）: 移動エリアタブとイベントタブの `canvasPng` は重ね描きを含まない。イベントタブの `mouse` の `rightClick` に `ctrl: true` を付けると、メニューを出さずにイベントの下のブロックを拾う（`selection` の `block`）。
- ステータスバーの補助の欄 `status.info`（`getField` の `value`。空なら `visible` が false）: マップタブのブロックの番号・移動許可・挙動、Ctrl＋右ドラッグの間の矩形の大きさ、隣のマップの帯の上の「バンク.マップ 名前 (X, Y)」。`status` の `panels` は左・補助・右の順。

## Phase3 の部品と命令（接続・描画）

- 隣のマップの帯（#223）: `{"cmd":"neighbors.state","wait":true}` で、見せ方の設定（`view`: `band` / `all` / `off`）、帯の幅（`range`。マップ全体なら null）、隣の一覧（`index`・`direction`・`side`・`bank`・`map`・`offset`・`placement`（隣のマップ全体の置き場所）・`band`（見せる部分。隣のマップの中の座標）・`bandAt`（見せる部分の置き場所）。座標はどれも主マップの左上を (0, 0) としたマス）、主マップのまわりの余白 `margins`、接続のある辺 `connectedSides`、描き終えたか `done`、マップを切り替え始めてから帯を描き終えるまで `neighborsMs`、帯を作るのにかかった時間 `buildMs` を返す。`wait: true` なら描き終えるまで待つ。
- `canvasPng` のマップのタブ（`map` / `movement` / `event`）に `neighbors: true` を付けると、隣のマップの帯と主マップの枠も含めた画像を返す（無ければ主マップだけ）。
- `mouse` のマップのタブの `cell` は主マップの左上が原点。負の値や大きさを超える値で、隣のマップの帯の上を指せる（例: 上の帯の上のダブルクリック `{"cmd":"mouse","target":"map","action":"dblclick","cell":[5,-3]}`）。`px` は今までどおり部品（ステージ）の左上から。
- 見せ方の切り替えはメニューのアクション `neighbors.band` / `neighbors.all` / `neighbors.off`（`{"cmd":"action","id":"neighbors.off"}`）か、`{"cmd":"setting","key":"neighborView","value":"off"}`。比較テストは AdvanceMap と同じ見た目で比べるため、起動のたびに `off` にする。
