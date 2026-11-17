# 自動操作の入口（テスト用）

## スクリプトの再生（実装中）

プロジェクトとマップを開いて使います。再生は編集中のスクリプトを読み取り、ROMやマップを書き換えません。

| 命令 | 引数 | 結果・操作 |
|---|---|---|
| `playback.start` | `label`、または `kind: person/sign/trap/map` と `index` | 現在のマップで再生を準備。人物と現在のフレームを返す。イベントのスクリプトが ROM のアドレスのままなら、ROM から再生する（素の ROM だけでもよい。`entry` は `ROM_08XXXXXX`） |
| `playback.stop` | なし | 再生を終了し、イベント表示とスクロールを戻す |
| `playback.state` | なし | `active`、始めたラベル `entry`、始まり方 `trigger`、`playing`、`speed`、`frame`、`lastFrame`、人物・カメラ・画像の診断 |
| `playback.timeline` | なし | 区間 `segments`、印 `markers`、送り先 `keyFrames` |
| `playback.seek` | `frame` | 任意のフレームへ移動して一時停止 |
| `playback.step` | `direction: previous/next`、`singleFrame`（任意） | 動きの前・中・後へ移動。`singleFrame: true` なら1フレーム |
| `playback.speed` | `value: 0.25/0.5/1/2/4` | 再生速度の変更 |
| `playback.play` | なし | 再生・一時停止の切り替え。文で止まっていれば続きへ |
| `playback.answer` | `key`、`taken`（真偽値） | 不明な条件分岐の答えを替え、最初から計算し直す |
| `playback.player.place` | `x`・`y`、`gender`・`facing`（省略可） | 仮の主人公を置く（「ここに仮の主人公を置く」と同じ。置いただけでは踏むスクリプトを始めない）。返事は `player` |
| `playback.player.move` | `direction: down/up/left/right` | 仮の主人公を 1 マス歩かせる（矢印キーと同じ）。踏むスクリプトなら再生を始め、準備ができるまで待つ。返事は `player` と `playback`（`playback.state` と同じ） |
| `playback.player.walkStart` | `direction: down/up/left/right` | 仮の主人公の 1 マスの歩きを、時計を使わずに始める（#493。歩きのコマを 1 フレームずつ確かめる用）。主人公はすぐ行き先のマスに移り、絵は `playback.player.walkStep` で進める。返事は `player` と `walk`（`frame`・`pixel`（画素の位置）・`manual`。歩いていなければ null） |
| `playback.player.walkStep` | `frames`（省略で 1） | `walkStart` で始めた歩きを `frames` フレーム進める。16 フレーム目（`frame` 15）を過ぎると歩き終え、踏むスクリプトなら再生を始めて準備ができるまで待つ。返事は `player`・`walk`（歩き終えたら null）・歩き終えたときは `playback`（`playback.state` と同じ） |
| `playback.player.talk` | なし | 向いている先の人物・看板に話しかける（Enter と同じ）。返事は `player`・`playback`・`status`（何も無いときの知らせ） |
| `playback.edit` | `segment`（`playback.timeline` の `segments` の番号）、`edit`（`{type: "replace", index, value}`・`{type: "direction", index, direction}`・`{type: "insert", index, value, after?}`・`{type: "delete", index}`・`{type: "move", from, to}`・`{type: "repeat", index, count}`。`index` は移動データの何番目か）、`shared`（共用の移動データのとき `rewrite` / `copy`。省略で聞く） | 箱の編集を `.s` へ書き戻し、計算し直すまで待つ。返事は `result`（`changed`・`newLabel`。外で変わっていて書かなかったときは null）と `state` |
| `playback.locks` | なし | 箱ごとの編集できない理由（`segments` と同じ並び。編集できるなら null） |
| `playback.settled` | なし | 画面の操作で始めた書き戻しと、読み直しが済むまで待つ |
| `playback.layout` | なし | タイムラインの倍率 `scale`、横のスクロール、箱 `segments`（`left`・`width`・`top`・`active`）、印 `markers`、縦線 `cursor` の位置（画素） |
| `playback.wheel` | `delta`（負で拡大）、`x`（部品の左端からの画素） | タイムラインの上で Ctrl＋ホイールを回したのと同じ |
| `playback.message` | なし | メッセージのウィンドウの今のページ（#497）。`page`・`pages`・止まる理由 `reason`、フォントを読んだ ROM `font`（`kana`・`kanji`。null は開いた ROM、`kanji` が無ければ漢字無し）、ウィンドウの左上 `origin` と倍率 `scale`、字 `items`（`kind: glyph/fallback/placeholder`、ウィンドウの中の `x`・`y`・`width`、`text`、`source: font/kanji`・`font`・`code`、補った理由 `reason`、色 `colors`）、はみ出し `overflowRight`・`overflowBelow`。文が出ていなければ null |
| `playback.choose` | `key`（印の `choice.key`）、`value` | 選択肢の答え（LASTRESULT の値）を替えて計算し直す。今のフレームは保つ |
| `pathDraw.open` | `actor`（localId。主人公は 255。省略で主人公）、`start`（`{x, y, facing}`。省略で人物の置き場所）。または `from: playback`（再生の帯の「道をなぞる…」）・`from: person` と `index`（人の番号の右クリック）・`from: line` と `path`・`line`（0 始まり。エディタの applymovement の行の右クリック） | 道をなぞるウィンドウ（#517・#518）を開き、新しいラベルの名前の案ができるまで待つ。返事は `pathDraw.state` と同じ |
| `pathDraw.apply` | `mode: replace/new`、`label`（new のときの名前）、`shared: rewrite/copy`（共用の移動データのとき。省略で聞く）。省略でウィンドウの選択 | 「ここで使う」。返事は `result`（`changed`・`label`・`newLabel`。聞いたウィンドウで取りやめたら null）と `state` |
| `pathDraw.state` | なし | `open`・`actor`・`start`・`end`（終わりの位置と向き）・`target`（置き換える先。`commandPath`・`commandLine`・`label`）・`mode`・`label`・`speed`・`ops`（操作の列）・`values`（移動コマンドの値）・`rows`（一覧の文）・`problems`（通れない歩き。`index`・`reason: outside/collision/elevation/person`・`x`・`y`）・`canUndo`・`canRedo`・ウィンドウの左上 `position`（`left`・`top`） |
| `pathDraw.step` | `direction`（`face: true` なら向きだけ）、または `to: {x, y}`（ドラッグと同じく横を先に、次に縦に歩く） | 命令を足す |
| `pathDraw.edit` | `action: undo/redo/clear/wait/speed`、`frames`（wait）、`value`（speed。歩きの命令の番号） | 1 つ戻す・やり直す・全部消す・待ちを足す・歩きの速さを変える |
| `pathDraw.close` | なし | ウィンドウを閉じ、マップの上の下見を消す |
| `pathDraw.move` | `left`・`top`（メインの画面の中の画素） | ウィンドウを動かす（タイトルの帯をドラッグするのと同じ。画面からはみ出さないよう詰める）。返事は `pathDraw.state` と同じ |

再生バーのIDは `playback.bar`、操作は `playback.play`・`stop`・`first`・`previous`・`next`・`seek`・`speed`・`gender`・`facing`（すべて `playback.` を先頭に付ける）です。居ない人物のチェックは `playback.absent.<localId>`（見出しはイベントの欄の「人No.」と、スクリプトの番号 localId の両方。外した人物への `applymovement` は無視して印を出す。#494）。`playback.details` は今のフレームの文や印、`playback.message` はメッセージのウィンドウ（Canvas と本文）です。`playback.timeline` はタイムラインの部品、`playback.segment.<n>` は区間の箱（n は `playback.layout` の `segments` の並び順で、タイムラインの行を上から、行の中を左から数えたもの。`playback.timeline` の `segments` の番号ではない。その箱がタイムラインの何番目の区間かは、`playback.layout` の `segments[n].index` で分かり、`playback.edit` の `segment` にはこちらを渡す）、`playback.marker.<番号>` は全体の印、`playback.condition` は踏むスクリプトの条件、箱の右クリックのメニューの項目は `playback.edit.down`・`up`・`left`・`right`・`replace`・`insertBefore`・`insertAfter`・`repeat`・`delete`、差し替えのウィンドウの一覧は `playback.replaceChoice`、`playback.choice.<印の番号>` は選択肢の答えの欄です。道をなぞるウィンドウの部品は `pathDraw.actor`・`x`・`y`・`facing`・`speed`・`waitFrames`・`addWait`・`list`・`count`・`warning`・`undo`・`redo`・`clear`・`modeReplace`・`modeNew`・`label`・`apply`、再生の帯のボタンは `playback.pathDraw`、マップの上の下見は `pathDraw.overlay` です（すべて `pathDraw.` を先頭に付ける）。エディタの `editor.playbackHighlights` は、開いているファイルごとの実際の強調範囲（UTF-16の `from`・`to`）を返します。

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
python tests/automation/usage_template_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]   # 使われている番号の索引・トレーナーの一覧と自動生成、プロジェクトフォルダが無いときのひな形と「未使用」ボタン（#227・#243〜#245）
python tests/automation/script_theme_check.py --rom <素の BPRJ> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ> --exe <zigzagumap.exe> [--shots <フォルダ>]
    # スクリプトエディタのテーマ 4 つで、ウィンドウの部品（帯・検索の欄・補完・ホバー・ビルドの欄・波線の一覧・ダイアログ・スクロールバー）が同じテーマの色になること
python tests/automation/feedback_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>]
    # Phase1 のフィードバックで入れた動き（表示メニュー、透明度のスライダー、マップの外のイベントの帯、場所の設定のかんたん表示、
    # ROM を開いたあとのフォルダ選択、ヘルプ）と、Phase3 のフィードバック（#296 読み込み時間を出さない・#297 左下の ROM 情報の欄が無い）を
    # ZigzaguMap だけで確かめる。--shots で新しい画面のスクリーンショットを書く
python tests/automation/phase3_view_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>] [--only <名前> ...] [--chronos <Chronos の写し>]
    # Phase3 の表示・ホバー・スタンプ・クローン（配置の共有など）。名前はスクリプトの CHECKS の鍵。--chronos を付けると、
    # Chronos の写し（読むだけ。出力しない）で .s のラベルの要約（hoverAsm）とトレーナーを直すウィンドウ（trainerEdit）も確かめる
python tests/automation/connection_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>] [--only 222,223]
    # Phase3 の接続と描画（issue ごとに起動し直して確かめる。--only で番号を選ぶ）
python tests/automation/triple_layer_check.py --rom <素の BPRJ> --exe <zigzagumap.exe> [--shots <フォルダ>] [--work <出力の作業フォルダ>]
    # トリプルレイヤー（#299・#302）: blockInfo、ブロックエディタでトリプルレイヤーにする・3枚目のレイヤーのレイヤーの 4 マス・確かめのウィンドウ・1 回の取り消し・
    # 出力した tileset.json の Blocks と Behaviors・主の 639 番の拒否・値 5〜7 の注意。ブロックエディタでは `state` に
    # third（3枚目のレイヤーのレイヤーの 4 タイル）・triple・thirdVisible が出る。トリプルレイヤーの保存は `setTripleLayer` コマンド
python tests/automation/transplant_check.py --rom <素の BPRJ> --source <取り込む元の ROM> [--source ...] --exe <zigzagumap.exe> [--shots <フォルダ>] [--work <出力の作業フォルダ>] [--memory]
    # 別の ROM からタイルセットを取り込むウィンドウ（#314）: 一覧・絵・情報・変わることの一覧・両方と配置も写す・1 回の取り消し・出力・主だけ・
    # --memory でウィンドウを閉じた後のメモリ。ウィンドウ（"window": "transplant"）の `state` は rom・game・mapCount・selected・parts・copyLayout・
    # report（変わることの一覧の行）・conversion（主・副のタイル数とブロック数、変換の結果）・target。部品は tp.pickRom・tp.maps・
    # tp.parts（0 両方 / 1 主だけ / 2 副だけ）・tp.copyLayout・tp.import・tp.close・tp.preview・tp.primaryInfo・tp.secondaryInfo・tp.report。
    # 元の ROM は queuePath で積んでから tp.pickRom を押す
python tests/automation/phase4_view_check.py --rom <素の BPRJ> [--project <CFRU-JP のフォルダの写し>] --exe <zigzagumap.exe> [--shots <フォルダ>] [--only <名前> ...]
    # Phase4 の表示・一覧・調査（#304〜#308・#315・#316）。名前はスクリプトの CHECKS の鍵。写しには書き込まない（出力しない）。
    # --project を付けると「ここに落とし物を追加」も確かめる
python tests/automation/pen_check.py --rom <素の BPRJ の写し> --exe <zigzagumap.exe> [--shots <フォルダ>] [--work <作業フォルダ>] [--only <名前> ...]
    # Phase4 の描く道具（#300・#301・#310〜#313・#335〜#338）。名前は triple・tripleTools・autopen・autopenBand・assist・assistReopen・
    # assistEdge・candidates。マップ作成補助のパーツは --work（既定は一時フォルダ）の maps\autopen\ に書く。ROM には書かない
python tests/automation/automation_dialog_check.py --rom <素の BPRJ の写し> --exe <zigzagumap.exe> [--project <CFRU-JP のフォルダ（読むだけ）>] [--only <名前> ...]
    # 自動操作の命令がダイアログの答えを待って止まらないこと（#380）。open（無いフォルダ・知らない種類の ROM・未出力の変更）、
    # scripts.table の open、warp.createMap、--project でスクリプトエディタの editor.rename・build.run・未保存のままの open。
    # 名前ごとに起動し直し、15 秒で返らない命令は失敗に数える
python tests/automation/tool_check.py --rom <素の BPRJ の写し> --exe <zigzagumap.exe> [--shots <フォルダ>] [--work <作業フォルダ>] [--only <名前> ...]
    # Phase5 の描く道具（#388〜#390）。名前は fill・line・smartPath・shift・resize。出力は --work（既定は一時フォルダ）に書く。ROM には書かない
```

本文は JSON 1 件で、返事は `{"ok":true,"result":...}` か `{"ok":false,"error":"..."}` です。

命令は分野ごとのファイル（`apps/desktop/src/app/automation/` の `core`・`fields`・`mouse`・`dialogs`・`menu`・`tree`・`images`・`status`・`events`・`hover`・`history`・`stamps`・`warpMap`・`blockUsage`・`view`・`process`・`script`・`scripts`・`link`・`usage`・`templates`・`trainers`・`neighbors`・`bag`・`composite`、Phase4 の `viewTools`・`tileset`・`pen`、Phase5 の `tools`）に分け、`index.ts` の 1 つの登録表にまとめています。`{"cmd":"commands"}` で登録されている命令の名前が出ます。自動操作の入口のコードは、自動操作で起動したときだけ読み込みます。

| cmd | 引数 | 動作 |
|---|---|---|
| `open` | `rom`、`project`（省略可）、`ask`（省略可） | ROM（とプロジェクトフォルダ）を開く。返事は `state` と同じ。ダイアログは出さない: 開けない（無いフォルダ・ROM でないファイルなど）ときと、未出力の変更やスクリプトエディタの未保存のファイルがある（画面からなら「出力しますか？」などと聞く）ときは、エラーで返し、開いていたものはそのまま残す（#380）。`ask: true` なら画面からと同じくダイアログで聞く（確認のテスト用。答えるまで返事は返らないので、別の接続から `dialog` で答える） |
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
| `state` | | 開いている ROM・プロジェクト・マップ（`map` は番号・名前・大きさと、主・副タイルセットのポインタ値 `primaryTileset`・`secondaryTileset`）、タブ、選択中のブロック、未出力のマップ、履歴の数、ステータスバー、ダイアログ、個人設定、`profile`、時間の記録、`jsHeap`（JavaScript のヒープ、MB）、`openedUrls`（ヘルプのリンクなどで開こうとした外部の URL。新しい順。自動操作のときはブラウザを開かない） |
| `status` | | ステータスバーの各欄（`panels`: 画面に出ている欄の文字列を左から。隠している補助の欄・接続の注意は入れない）と `left`・`right`・`error` |
| `title` | | 題名（`document`: ページの題名、`window`: ウィンドウの題名） |
| `dialogs` | | 開いているダイアログの一覧（開いた順。最後が手前）。画面内のダイアログ（`kind: "app"`。題名・本文・ボタン・入力欄の値・モーダルか）と、ファイル・フォルダを選ぶダイアログ（`kind: "native"`。種類・題名・ボタン・入力欄（選ぶパス）・種類の絞り込み・初めのフォルダ） |
| `dialog` | `input`、`press`（どちらも省略可）、`title`（省略時は手前のもの） | ダイアログに入力して、ボタンを押す（ボタンの文字列か `ok`・`yes`・`no`・`cancel`。`close` で ×）。ファイルのダイアログは `input` にパスを入れて `ok`（か「開く」「保存」）、`cancel` で取り消し。返事は押す前と後の一覧 |
| `queuePath` | `path`（null でキャンセル） | ファイル・フォルダを選ぶダイアログの答え。開いているダイアログがあればそれに答え（返事の `answered` が true）、無ければ次に出るダイアログの答えとして積む。自動操作のときは Windows のダイアログは一切出さず、答えが無ければ `dialogs` に出して待つ（Rust 側の `pick_*` も自動操作のときはダイアログを開かずにエラーを返す） |
| `menu.list` | | メニューの全項目（`path`: 階層の文言の列、`id`、`enabled`（親が無効なら無効）、`checked`、`submenu`、`shortcut`）。最近開いたものも含む。区切り線は出さない |
| `menu.run` | `path`（`"設定 > グリッドの表示"` か `["設定", "グリッドの表示"]`）か `id`、`wait`（ms、既定 100） | メニューの項目を実行する。メニューバーで選んだときと同じく、無効な項目とサブメニューは実行しない（失敗）。返事はステータスバーと開いているダイアログ |
| `tree.list` | `visibleOnly`（省略可） | マップ一覧の全項目（`text`: 未出力の印 ` *` を含む文字列、`depth`、`hasChildren`、`expanded`、`selected`、`opened`（開いているマップ）、`dirty`、名前の前の印 `mark`（`open` 開いている・`dirty` 未出力・`error` 読み込めなかった・null。#401）、`mapId`、`key`）。`visibleOnly: true` で開いている枝の中だけ |
| `tree.select` / `tree.open` | `key`、`text`、または `bank` と `map` | 項目を左クリック（選ぶだけ）／ダブルクリック（マップなら開いて開き終わるまで待つ、グループなら開閉）する。親が閉じていれば開いてから押す |
| `tree.rightClick` | `key`、`text`、または `bank` と `map` | マップの項目を右クリックしてメニューを出す（Phase5 #401）。項目は `contextMenu.state` で読み、`contextMenu.press` の `id`（`tree.open`・`tree.copyName`・`tree.copyId`・`tree.duplicate`）で押す。返事はその項目（`tree.list` と同じ形） |
| `clipboard.last` | | 最後にコピーした文字（自動操作で起動したときはクリップボードへ書かず、ここに残す） |
| `editHistory.state` | | 履歴のウィンドウ（Phase5 #402。ウィンドウを作っていなければ作るが、開きはしない）。`open`（出しているか）、`position`（今の位置。実行済みの操作の数）、`rows`（新しい順。`position`（押したときに移る位置）・`text`・`current`・`redo`（やり直せる分）。最後が「（最初の状態）」で `position` 0）。開く・閉じるは `action` の `view.history` |
| `view.layers` | `bottom`・`top`・`third`（true / false。省略した項目は変えない） | レイヤーごとの表示（Phase7 #513）。渡した項目を変えて描き直す（表示 > レイヤーの表示 のチェックと同じ。メニューの ID は `view.layer.bottom`・`view.layer.top`・`view.layer.third`）。返事は今の `bottom`・`top`・`third` と、ステータスバーの文 `status`（全部出していれば null。部品は `status.layers`） |
| `minimap.state` | `rebuild`（true で作り直しを待たずに作って送る） | ミニマップ（Phase7 #511。#542 から別ウィンドウ `minimap`）のメイン側の状態（メイン側の受け手を作っていなければ作るが、ウィンドウは開かない）。ウィンドウを開いているか `open`、ウィンドウの準備ができたか `ready`、縮小図の大きさ `width`・`height`、縮小の割合 `scale`（縮小図の画素 = マップの画素 × scale）、見えている範囲の枠 `frame`（縮小図の画素。マップを出すタブでなければ null）、作った回数 `builds`（開いてから）、作る時間 `buildMs`、最後に送った縮小図の大きさ `sentBytes`（base64 の文字数）、個人設定 `setting`（`show`・`town`）とウィンドウの位置 `placement`、今のタブのスクロールの位置 `scroll`。開く・閉じるは `action` の `view.minimap`。ウィンドウの中は `window: "minimap"` の `state`（`thumb`・`shown`・`displayScale`・`frame`・`note`・`town`・`stage`）、`canvasPng`（`minimap.canvas`・`minimap.townCanvas`）、`pointer`（`minimap.canvas`）、`setField`（`minimap.town`）で見る・操作する |
| `minimap.town` | `on`（true / false） | ウィンドウの「タウンマップも出す」の印を変えたのと同じ（個人設定に残し、ウィンドウの印も合わせる）。読み込んで送るまで待つ。返事は `minimap.state` と同じで、`town` は出していれば `loaded`・`frame`（今のマップの位置。`rect`（`page`・`x`・`y`・`width`・`height`）と出どころ `source`（`map`・`section`・`rom`））・`area`（出す範囲のマスと倍率 `scale`）・`text`（下の欄の文字）、出していなければ null |
| `minimap.click` | `x`、`y`（縮小図の画素） | 縮小図を押したのと同じ（その位置を表示の真ん中にスクロールする）。返事は `minimap.state` と同じ |
| `action` の `mcp.bridge`・`mcp.allowWrite`・`mcp.allowExport`・`mcp.allowScripts` | | MCP の窓口（Phase7 #521。設定 > MCP の窓口）の項目。専用の命令は無く、`action` か `menu.run` で押す。チェックの状態は `menu.list` で見られる（既定はすべてオフ。`mcp.bridge` をオンにすると 127.0.0.1 で待ち受け、AppData に `mcp.json` を書く） |
| `editHistory.goTo` | `position` | 履歴のウィンドウの行を押す（ウィンドウを出していれば画面の行を押し、出していなければ同じ処理を呼ぶ）。その位置まで戻す・進める。返事は `editHistory.state` と同じものと、動かした回数 `steps` |
| `allSettings.state` | | すべての設定のウィンドウ（Phase5 #404。`action` の `opt.allSettings` で開く）。`open`、チェックの欄の状態 `checks`（アクション ID → チェック）、プロジェクトの欄の値 `project`、最後の保存の結果 `message`。欄は `allSettings.<アクション ID>`（`setField` に true / false、ウィンドウを開く項目は `click`）、プロジェクトの欄は `allSettings.project.<outputRom / labelTemplate / useGlobal / lineMaxChars / linesPerPage>` |
| `allSettings.save` | | プロジェクトの欄を zigzagumap.json に保存して終わるまで待つ。返事は `ok` と `allSettings.state` |
| `projectWatch.check` | | ファイルの変化を調べる（Phase5 #404。メインのウィンドウに戻ったときと同じ。設定 `watchProject`（`opt.watchProject`）が外れていても調べる）。聞くダイアログが出たら待たずに返す（`dialog` の `press: "yes"` / `"no"` で答える）。返事は `projectWatch.state` と同じ |
| `projectWatch.state` | `wait`（省略可） | 控えているファイルの数 `watched`、最後の `projectWatch.check` の結果 `result`（`changes`（`changed`・`added`・`removed`。プロジェクトフォルダからの相対パス）・`reloaded`。答え待ちなら null）。`wait: true` なら終わるまで待つ |
| `userScripts.state` | `wait`（省略可） | 利用者のスクリプト（Phase5 #405）。Worker を作っているか `active`、置き場所の `files`、有効な `enabled`、登録された操作 `actions`（`id`・`label`）、`logs`（`level`・`text`）、読めなかったもの `loadErrors`。`wait: true` なら読み込みと動いている呼び出しが終わるまで待つ。管理のウィンドウは `action` の `scripts.manage`、チェックは `setField` の `userScripts.enable.<ファイル名>` |
| `userScripts.run` | `action`、`wait`（省略可） | 登録された操作を動かす（メニューからは `menu.run` / `action` の `scripts.run.<N>`。N は ツール > ユーザースクリプト の上からの番号で、キーの表の ID も同じ）。`wait: false` でなければ終わるまで待つ（ダイアログを出す操作は false にして `dialog` で答える）。返事は `userScripts.state` |
| `userScripts.reload` / `userScripts.stop` | | 読み直す（終わるまで待つ）／Worker を終わらせる。返事は `userScripts.state` |
| `mapExport.state` | | マップの画像の書き出しのウィンドウ（Phase5 #403。`action` の `image.export` で開く）。`open`、選択 `choice`（`whole`・`persons`・`warps`・`traps`・`signs`・`movement`・`grid`・`border`・`neighbors`・`format`（`png` / `bmp` / `gif-anim`）・`delayMs`・`skip`）、プレビューの大きさ `last`（`width`・`height`・`maps`（描いたマップの数）・`scale`）、ステータスバーの「フォルダを開く」が指すファイル `folder`（出していなければ null。部品は `status.openFolder`。自動操作で起動したときは押してもエクスプローラーを開かない）。プレビューを作り終えるまで待つ。選択は `setField` の `mapExport.rangeMap`・`mapExport.rangeWhole`・`mapExport.persons`〜`mapExport.neighbors`・`mapExport.grid`・`mapExport.png`・`mapExport.bmp`・`mapExport.gifAnim`・`mapExport.delayMs`・`mapExport.skip` で変える |
| `mapExport.run` | `action`（`save` / `copy` / `timelapse` / `gif-anim`） | ウィンドウのボタンを押して、終わるまで待つ。保存先は先に `queuePath` で渡す。返事は `save` が保存したパス、`copy` が大きさ、`timelapse` が `path`・`frames`・`width`・`height`（取りやめた・変更が無いときは null）、`gif-anim`（タイルアニメの GIF。Phase7 #514。形式に関係なく作る）が `path`・`frames`・`width`・`height`・長さ `durationCs`（1/100 秒）・周期がそろったか `complete`・ファイルのバイト数 `bytes`・1 コマの画像のバイト数 `frameBytes`・書く間のヒープの増え方 `heapGrowthMb`（取りやめた・動くタイルが無いときは null） |
| `setting` | `key`、`value` | 個人設定の値をこの起動の間だけ変える（ファイルには保存しない）。`theme`（`light` / `dark`）はすぐ画面と開いている別ウィンドウに当てる（メニューの 設定 > テーマ と同じ。`menu.list` の `theme.light`・`theme.dark` の `checked` も変わる） |
| `event.select` | `kind`（`person` / `sign` / `warp` / `trap` / `fly`）、`index` | イベントを選ぶ |
| `event.state` | | 選択中の種別と番号、`selected`（選んでいるイベント。複数選択なら全部。#399）、`ruler`（Shift＋右ドラッグのルーラーの `dx`・`dy`。出していなければ null。#400）、個数、表示中のマップのイベントと落とし物、`warpWarnings`（ワープできないブロックの上にあるワープの番号。#240）、`clones`（クローンの人の `index` と参照先 `target`（`bank`・`map`・`localId`）。#242。元の人の番号 `originIndex`（元のマップを読んでいない・元の人がいなければ null）と描く画像番号 `graphicsId`。#298） |
| `event.deletePlan` | `kind`（`person` / `sign` / `warp` / `trap`）、`index` | イベントの削除（#220）で消すものの計画（何も変えない）。`label`・`pointer`、`script`（`.s` の `scriptPath`・`removedLabels`・`keptLabels`（`label`・`reason`・`where`）・`removedStrings`・`keptStrings`）、`registry`（幅検査の登録から除く名前）、`rom`（`erase`・`keep`（`address`・`length`・`type`・`label`、`keep` は `reason`）・`problems`）、`romNote`（`outside` / `noProject` / `broken`）、書き換える `files`、確認のダイアログの行 `lines` |
| `event.delete` | `kind`、`index`、`confirm`（省略で true） | イベントを選んで削除する（ボタン・右クリック・Delete キーと同じ）。true なら確認のダイアログ「イベントを削除」を出したまま返す（`dialog` で「削除」（`ok`）か「キャンセル」を押す）。false なら確かめずに消し、書き足しが済むまで待つ（返事は `ok`・`status`・`selection`・`counts`） |
| `event.selectMany` | `items`（`[{"kind": "person", "index": 0}, ...]`） | イベントを複数選ぶ（Phase5 #399。Shift＋クリックで足したのと同じ。最後のものを欄に出す）。2 つ以上なら `event.state` の `selected` に全部が出る。返事は選択と `selected` |
| `event.duplicate` | | 選んでいるイベントを複製する（Ctrl+D と同じ。#399）。返事は `ok`・`status`・写しの `selected`・`counts` |
| `event.copy` | | 選んでいるイベントをコピーする（Ctrl+C と同じ。#519）。返事は `count`・`clipboard`（`source`・`items`（`kind`・`x`・`y`・`label`）・`pasting`）・`status` |
| `event.cut` | | コピーしてから消す（Ctrl+X と同じ）。削除の確認のダイアログを出したまま返す。返事は `count`・`clipboard`・`dialogs` |
| `event.paste` | `x`・`y`（省略可） | `x`・`y` があれば、そのマスを左上にして貼る（右クリックの「ここに貼り付け」と同じ）。無ければ影をマウスに付けて待つ（Ctrl+V と同じ。左クリックで置き、Esc で取りやめ）。返事は `ok`（置けたか。待つときは null）・`status`・`selected`・`counts`・`clipboard`。影の Canvas は `event.pasteGhost` |
| `event.deleteSelected` | `confirm`（省略で true） | 選んでいるイベントをまとめて削除する（Delete キーと同じ。#399。確認は 1 回）。`confirm` の扱いと返事は `event.delete` と同じ |
| `contextMenu.state` | | 開いている右クリックのメニュー（`items`: `id`・`label`・`enabled`）。無ければ null。イベントタブのマップは `mouse` の `rightClick` で開く（項目 `delete`「イベントを削除」と `openScript`「スクリプトを開く」、マップの中のマスでは `add.person`・`add.sign`・`add.trap`・`add.warp`「ここに○○を追加」と、プロジェクトフォルダがあれば `add.itemBall`「ここに落とし物を追加」。#304） |
| `contextMenu.press` | `id`（項目の `id` か文字列） | メニューの項目を押す。返事は開いているダイアログとステータスバー |
| `romErase.state` | | `maps\rom_erase.json` の範囲（`ranges`: `address`・`length`・`type`・`bank`・`map`・`event`・`index`）、未出力の変更 `modified`、読めなかった理由 `loadError` |
| `commands` | | 登録されている命令の名前 |
| `windows` | | 開いているウィンドウの一覧（`label`、`title`、`visible`、`ready`） |
| `exit` | | 確認なしで終了する。待っている個人設定の書き込み（変えてから 300ms まとめて書く）は、終わる前に済ませる（× やファイル > 終了で閉じたときと同じ。#406） |
| `settings.flush` | | 待っている個人設定の書き込みをすぐ済ませる（`exit` が先に呼ぶ。`setting` で変えただけの値は書かない） |
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
| （ブロックエディタなど宛て） | `window`（`block-editor` / `palette-editor` / `block-adjust` / `transplant`）と各命令の引数 | `window` を付けると、そのウィンドウで命令を実行する（仕組みはワールドマップエディタと同じ。下の段落）。使える命令は `state`（欄の値）、`getField` / `setField` / `click`（`field:<AdvanceMap の部品名>` も可）、`ui.list` / `fields`、`action`（メニューの項目。ブロックエディタの `tiles.save1`・`blocks.amount`・`palette.commit` など）、`dialogs` / `dialog` / `queuePath`（メインと同じ）、`key`、`pointer`（`id` の部品の上。`x`・`y` は部品の左上から）、`canvasPng`（`id` の Canvas）、`snapshot`（メインから届いたタイルセットの写し）、`scroll` / `view.scroll`（`id` の部品の枠。ブロック一覧は `be.blocks`、引数はメインと同じ）、`close`、`undo` / `redo`。`screenshot` も `window` で別ウィンドウを取れる。パレットエディタだけ `pickAt`（`source` のウィンドウの画像の `x`・`y` の色をスポイトで拾う）、移植のウィンドウだけ `transplant.select`（下の「Phase4 の部品と命令」）。マップ作成補助（`map-assist`）は仕組みがワールドマップエディタと同じで、命令は下の Phase4 の節 |

AdvanceMap の部品名（`field:<名前>`）は、`apps/desktop/src/app/automation/amNames.ts` の対応表（アプリ独自の ID → AdvanceMap の部品名。作業フォルダの inventory の部品表とフォーム定義から作った）から、自動操作の入口が動いているときだけ部品に `data-am-name` として付けます（通常の起動では付けない）。同じ名前の部品が複数あるときは表示中のものを使います。ワールドマップエディタは AdvanceMap の部品名を `data-auto-id` に使っているので、そのまま通ります。全画面の対応表（AdvanceMap の部品名 → ID）は `python tests/compare/gen_am_names.py --rom <素の BPRJ> --exe <zigzagumap.exe>` で実際の画面から集めて `tests/compare/am-names.json` に書きます。

ROM を開くメニュー・ツールバー・ドラッグ＆ドロップ・組のフォルダが記録されていない最近開いたものでは、ROM を選んだあとに組のフォルダを選ぶダイアログ（`dialogs` の `kind: "native"`、`type: "folder"`）が出ます。ただし 設定 > ROM ごとに前回のプロジェクトフォルダを覚える（`action` の `opt.rememberRomProject`、個人設定 `rememberRomProject`。既定 true）がオンで、その ROM の前回のフォルダ（個人設定 `romProjects`。ROM の小文字のパス → フォルダ）が残っていれば、ダイアログを出さずにそのフォルダで開き、ステータスバーの左に「前回のフォルダを開きました: <場所>」と出します（#278）。`queuePath` にフォルダか `null`（キャンセル。ROM だけで開く）を渡します。`open` 命令はダイアログを出さずに、渡した ROM とプロジェクトで開きます。

Phase1 のフィードバックで足した部品の ID: 透明度のスライダー `view.opacity.slider`（`setField` に 0〜100）・`view.opacity.value`（「30%」）・`view.opacity.close`、マップの外のイベントの帯 `outside.bar`（`getField` の `visible`）・`outside.fix`（マップの内側に戻す）、場所の設定タブの切り替え `header.mode.simple`・`header.mode.classic`（`click`）・`header.advanced`（高度なヘッダーを表示）、かんたん表示 `easy.region`・`easy.newName`・`easy.rename`・`easy.showName`・`easy.music`・`easy.musicNo`・`easy.weather`・`easy.mapType`・`easy.battleType`・`easy.cave`・`easy.bike`・`easy.run`・`easy.escape`・`easy.tileset1`・`easy.tileset2`・`easy.changeTilesets`・`easy.width`・`easy.height`・`easy.resize`・`easy.borderWidth`・`easy.borderHeight`・`easy.resizeBorder`・`easy.connections`・`easy.openConnections`（マップスクリプトは `easy.scriptNo` など、くわしく表示の `header.` を `easy.` にしたもの）、ヘルプの文書のウィンドウ `help.doc`（開いている文書のパス。画面には出さず、`getField` の `value` で読む）・`help.content`（本文。`view.scroll` の `id` に使える）・`help.home`（リンクで別の文書へ移ったときに本文の先頭に出す「← Read meに戻る」。元の文書の離れた位置へ戻る。#219 で「戻る」ボタン `help.back` の代わりにした）・`help.close`・本文のリンク `help.link:<行き先>`（`help.link:#ショートカット`、`help.link:docs/automation.md` など。`click` で押す）、バージョン情報 `about.version`・`about.link`。

イベントの削除の確認のダイアログの部品の ID は `eventDelete.list`（消すものの一覧）・`eventDelete.ok`・`eventDelete.cancel`、右クリックのメニューは `contextMenu` と `contextMenu.<項目の id>` です。

イベントタブの部品の ID（`getField` / `setField` / `click` の `id`）は `event.kind`、`event.number`、`event.cursor`、`event.remove`、`event.person.x` のような形です（`event.<種別>.<欄>`、イベントマネージャーは `event.manager.persons` と `event.manager.apply`）。

部品の ID は `<場所>.<名前>` の形です（例: 場所の設定タブ `header.music`・`header.saveScripts`、高度な表示 `pro.footer`・`pro.saveFooter`、コネクションマネージャー `conn.direction`・`conn.save`・`conn.down1`、出現ポケモンタブ `wild.type`・`wild.rate`・`wild.rateBar`・`wild.min.1`・`wild.species.1`・`wild.save`、追加ダイアログ `wildAdd.0`〜`wildAdd.3`・`wildAdd.ok`、ブロックエディタ `be.blocks`・`be.tiles`・`be.block`・`be.palette`・`be.xflip`・`be.attr0`〜`be.attr3`・`be.behavior`・`be.save`、パレットエディタ `pal.color.0`〜`pal.color.15`・`pal.red`・`pal.hex`・`pal.apply`・`pal.pick`、一括変更 `adj.tileset2`・`adj.to.0`〜`adj.to.14`・`adj.save`、新しいマップ `newMap.name`・`newMap.width`・`newMap.tileset1`・`newMap.create`、マップの追加/挿入 `mapInsert.replaceBank`・`mapInsert.replaceMap`・`mapInsert.replace`・`mapInsert.countBank`・`mapInsert.count`・`mapInsert.countApply`、マップバンクヘッダー `bankHeader.remaining.<バンク>`・`bankHeader.newBank`・`bankHeader.apply`、マップタブの `map.makeMap`・`map.makeBank`、マップ一覧の根 `tree.root.h`・`tree.root.i`・`tree.root.f` と「マップファイル」の項目 `tree.mapFile.<番号>`（根と項目は `key` の `Enter` で開く）。一覧は各部品を作るコードの第 1 引数です。作業用のマップ（新規作成・`.map`。バンク -1）は `selectMap` では開けません（`action` の `tools.previousMap` で戻れます）。

`scripts.table` の `action`:

| action | 引数 | 動作 |
|---|---|---|
| `get` | | 対応表を読むだけ |
| `open` / `close` | | 画面を開く／閉じる（メニューの `tools.scriptsTable` と同じ）。CFRU-JP のフォルダが無ければ、案内のダイアログを出さずにエラーで返す（#380） |
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
| `state` | | 読み込んだか、面、選んでいるマス、両レイヤーの値、マスの値、地名の位置と行き先、メインで開いているマップ、履歴の有無、開いているプロジェクトのビルドが人ID をゲームに反映するか `visitFlagsInGame`（#499。ROM だけなら null）、人ID の注意（`Lbl_FlagNotInGame`）を出しているか `flagNoteShown` |
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
| `editor.text` | `path`（省略で表示中のもの） | 本文（改行は `\n`） |
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
| `editor.complete` | `line`・`column` か `offset`、`filter`（省略で打った分）、`limit`（既定 50）、`show`（true で候補のウィンドウを出す） | その位置の補完（`context`（`op` / `argument`）、`argIndex`、引数の種類 `kind`、置き換える範囲 `from`・`to`、`word`、候補の総数 `total`、絞った数 `count`、候補 `items`（`label`・`type`・`detail`）） |
| `editor.definition` | `line`・`column` か `offset`、`go`（true で移動する） | その位置の名前の定義（`definition` の `kind`（`label`・`string`・`equ`・`macro`）・`name`・`targets`（`path`・`line`））。`go` なら移動して、`moved`・`active`・`cursor`・戻る履歴の数 `back`・下の帯の `message`・`dialogs`。行き先のファイルを開けないときは、`editor.open` と同じくダイアログを出したまま返す |
| `editor.back` | | 定義へ移動する前の位置へ戻る（Alt+← と同じ）。返事は `moved`・`dialogs`・`active`・`cursor`・`back`。戻る先のファイルを開けないときはダイアログを出したまま返す |
| `search.project` | `text`・`caseSensitive`・`regexp`・`wholeWord`・`scope`（`all`・`asm`・`string`）。省略で欄の値 | 全ファイル検索の欄（#520）を開いて探す。返事は `files`（`path`・`lines`（`line`・`text`・`ranges`））・`count`・`truncated`・`error`（正しくない正規表現）・`ms`・`scanned`（探したファイルの数）。結果の行の部品は `search.result.<n>`（ファイルを並べた順に数えた行）、欄は `search.panel`・`search.input`・`search.case`・`search.regexp`・`search.word`・`search.scope`・`search.run`・`search.status`、下のタブは `se.bottom.build`・`se.bottom.search` |
| `search.projectState` | | 全ファイル検索の欄が出ているか（`open`）と、最後の結果（`state`） |
| `editor.search` | `query`・`replace`・`regexp`・`caseSensitive`・`wholeWord`（省略で前の値）、`action`（`find`（既定）・`next`・`previous`・`replace`・`replaceAll`・`selectAll`・`close`） | 検索の欄を開いて条件を入れ、`action` を行う。返事は一致の一覧 `matches`（`line`・`column`・`text`。500 件まで）、`count`、`selection`、`dirty`。`replace` は、選んでいる一致を置き換えて次を選ぶ（一致を選んでいなければ、次の一致を選ぶだけ。置換の欄のボタンと同じ） |
| `editor.select`（広げたもの） | 上の 1 つの範囲に加えて、`add`（true で今の選択に足す）、`ranges`（範囲の配列）、`rect`（`line`・`column`・`toLine`・`toColumn` の矩形） | 複数の範囲・矩形の選択 |
| `editor.command` | `name`（`moveLineUp`・`moveLineDown`・`copyLineUp`・`copyLineDown`・`toggleComment`・`selectNextOccurrence`・`selectSelectionMatches`・`addCursorAbove`・`addCursorBelow`・`undo`・`redo`・`startCompletion`・`openLintPanel`・`closeLintPanel`） | エディタの操作を実行し、本文 `text` と `selection` を返す |
| `editor.contextMenu` | `line`・`column`、`press`（押す項目の ID。省略可） | 本文の位置で右クリックし、出たメニューの項目（`id`・`label`・`enabled`）を返す。ラベルの上は `playScript`、`applymovement` の行は `pathDraw`（#518） |
| `editor.mouse` | `line`・`column`、`toLine`・`toColumn`（あればドラッグ）、`ctrl`・`alt`・`shift` | 本文の位置でマウスを押す（Ctrl+クリックの定義へ移動・カーソルを足す、Alt+ドラッグの矩形選択） |
| `editor.perf` | `line`・`column`、`count`（既定 30） | その位置で 1 字ずつ打ち、画面の更新（次のフレーム）までの時間を測る（`averageMs`・`maxMs`・`lines`）。打った字は消し、履歴にも残さない |
| `editor.diagnostics` | | 波線を調べ直して、表示中のファイルの波線（`line`・`column`・`severity`・`source`（`unknownCommand` などの種類か、外から足したものの出どころ）・`message`・`text`）を返す |
| `editor.widthCheck` | `wait`（true で、動いている検査が終わるまで待つ） | 保存時の幅検査の結果。`busy`、動かした回数 `runs`、最後の結果 `last`（`path`・終了コード `exit`・拾った誤り `errors`（`path`・`line`・`label`・`message`）・登録ファイルへの書き足し `registry`（`path`・`added`・`unresolved`・`removed`・登録の無いファイルなら `notChecked`）・`failed`）、出力の最後の 200 行 `log` |
| `editor.stringEdit` | `label`・`text`、または `line`・`column`・`label`・`open`（true で入力欄を出す） | 文字列のラベルの本文を差し替える（`text` の改行は `\n` などの制御記号のすぐ後ろにだけ書け、そこで `.string` の行を分ける。#221）（`.string` のタブを未保存にする。開いていなければ裏で開く）。返事は `path`・`dirty`・`tabs`・`dialogs`（`.string` を開けないときはダイアログを出したまま返す）。`open` なら、ホバーの「本文を編集」と同じ入力欄を出す |

| `build.run` | `wait`（true で終わるまで待つ）、`confirm`（false で保存・出力の確認を飛ばす） | ビルドの欄でビルドする（ツール > ビルドと同じ。#198）。返事は `build.state` と開いているダイアログ。保存・出力の確認のダイアログが出たら、`wait` でも答えを待たずにそこで返す。設定（scripts.json の `build`）を読めないときはダイアログを出さずにエラーで返す（#380） |
| `build.state` | | `running`・`step`（今の手順、0 から）・`steps`（手順の列）・`result`（`ok`・`code`・`killed`・`failedStep`・`ms`）・`problems`（拾ったエラー。`kind`・`severity`・`message`・`path`・`line`・`symbol`・`logLine`）・`lines`（ログの行数）・`outputRom` |
| `build.log` | `from`（省略で 0） | ログの行（`stream`（`stdout` / `stderr` / `info`）・`line`・`step`） |
| `build.stop` | | ビルドを止める（子プロセスごと） |
| `editor.import` | `key`（省略で表示中の ROM のタブ）、`rename` | ROM のタブを取り込む（「.s に取り込む」と同じ。#207。マップスクリプトの「見る」で開いたタブも）。`rename` を渡さなければ名前の一覧のダイアログを出したまま返す（`dialog` で「取り込む」を押す） |
| `editor.rename` | `from`、`to`（省略で名前を聞くダイアログを出す） | ラベル名を変える（F2 と同じ。#203）。返事の `result` は `count`（変えた数）・`files`・`uses`（メインで変えたイベントの数）。`to` を渡したときは、ラベル名として正しくない名前と、書けなかったファイル（ほかのファイルは変えたあと）をエラーで返す。`to` を省くと名前を聞くダイアログを出したまま返す（`result` は null、`dialogs` に出る。#380） |
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
- マップ名で探して開くウィンドウ（`action` の `map.find`、Ctrl+F）: 題名「マップ名で探して開く」、入力欄 `mapFind.input`（`setField` で入れると候補を作り直す）、候補の一覧 `mapFind.list`・候補 `mapFind.item:<バンク>.<マップ>`、`dialog` の `press` は `ok`（先頭か選んだ候補を開く）・`cancel`。
- マップ一覧の絞り込みの欄 `tree.filter`、× のボタン `tree.filterClear`。

- Ctrl を押している間（#238）: 移動エリアタブとイベントタブの `canvasPng` は重ね描きを含まない。イベントタブの `mouse` の `rightClick` に `ctrl: true` を付けると、メニューを出さずにイベントの下のブロックを拾う（`selection` の `block`）。
- ステータスバーの補助の欄 `status.info`（`getField` の `value`。空なら `visible` が false）: マップタブのブロックの番号・移動許可・挙動、Ctrl＋右ドラッグの間の矩形の大きさ、隣のマップの帯の上の「バンク.マップ 名前 (X, Y)」。`status` の `panels` は左・補助・接続の注意・右の順（出ている欄だけ）。

| cmd | 引数 | 動作 |
|---|---|---|
| `stamps.list` | | スタンプ（#239）。`all`（全部。`name`・`width`・`height`・`primaryTileset`・`secondaryTileset`・`secondaryUsed`・`withMovements`・`path`（書いたファイル。メモリだけなら null）・`fits`（今のマップに貼れるか））、`fitting`（今のマップに貼れるものの名前）、`shown`（マップタブの一覧に出ている名前）、`memoryOnly`（出力先のフォルダが無くメモリだけか）、`pending`（まだ書いていない数）、`problems`（読めなかったファイル） |
| `stamps.save` | `name`、`overwrite`（true で同じ名前を上書き） | 今の選択をスタンプにする（「選択を保存」と同じ。名前は聞かない）。返事は `ok` と `stamps.list` |
| `stamps.select` | `name` | 一覧の項目を押すのと同じ（選択にする。四角でないスタンプは `selection` の `block.holes` に貼らないマスを持つ）。返事は `ok` と `selection` |
| `stamps.rename` | `name`、`to` | 名前を変える（ファイル名も変わる）。返事は `ok` と `stamps.list` |
| `stamps.remove` | `name` | 消す（確かめない。ファイルも消す）。返事は `ok` と `stamps.list` |

- スタンプの部品の ID: 欄 `stamp.panel`、「選択を保存」`stamp.save`、一覧 `stamp.list`、項目 `stamp.item:<名前>`（`click` で選ぶ）、一覧の下の知らせ `stamp.note`。右クリックのメニューの項目は `stampRename`・`stampOverwrite`・`stampRemove`（`contextMenu.press`）。

| cmd | 引数 | 動作 |
|---|---|---|
| `blockUsage` | `block`（省略で選んでいるブロック） | ブロックの使用回数（#235）。索引ができるまで待つ。`count`（全マップ）、`here`（表示中のマップ）、`movements`（移動許可 → 数）、`mostMovement`、`mismatches`（表示中のマップで移動許可がいちばん多い値と違うマス `x`・`y`・`movement`）、`selectedMovement`（選んでいる移動許可）、`marks`（今付けている印の数。`map`・`movement`） |

- マップタブの右の欄（#235）: 「移動許可を自動で選ぶ」`map.autoMovement`（`setField` に true / false）、使用回数 `map.blockUsage`、多い移動許可 `map.blockUsageMost`。表示 > 移動許可の強調は `action` の `view.usageMarks`（個人設定 `usageMarks`）。比較テストは `setting` で `autoMovement` と `usageMarks` を false にしてから比べる。

| cmd | 引数 | 動作 |
|---|---|---|
| `warp.samples` | `index`（表示中のマップのワープ） | 「行き先のマップを作る」（#241）の見本の一覧（`source`・`sourceWarp`・`map`・`width`・`height`・`primaryTileset`・`secondaryTileset`・`entry`） |
| `warp.createMap` | `index`、`sample`（見本の番号か null で見本なし）、`copyLayout`（既定 true）、`bank`（省略でバンクを聞くウィンドウを出す） | ウィンドウを出さずに行き先のマップを作り、ワープを向け合って新しいマップを開く。返事は `target`（作ったマップ）・`map`・`status`・`dialogs`。ワープが無い・バンクが範囲外か満杯・作れないときは、ダイアログを出さずにエラーで返す。`bank` を省くと、バンクを聞くウィンドウを出したまま返す（`target` は null。答えたあとのエラーは画面からと同じくダイアログで出す。#380） |

- 右クリックのメニュー（イベントタブのワープ）の項目 `createWarpMap`（`contextMenu.press`）で、見本を選ぶウィンドウ（題名「行き先のマップを作る」。見本 `warpMap.sample:<番号>`、見本なし `warpMap.noSample`、「見本の配置をそのまま写す」`warpMap.copyLayout`、`dialog` の `press` は `ok` / `cancel`）と、バンクのウィンドウ（題名「新しいマップのバンク」）が出る。

- クローン（#242・#277）: 表示 > クローン（`action` の `view.clones`、個人設定 `showClones`。既定は false）が true の間だけ、イベントタブで人を動かす（`mouse` の `drag` を離したとき、`setField` の `event.person.x` などの欄、イベントマネージャーの数 `event.manager.persons` と `event.manager.apply`、`template.place`、`event.delete`）と、隣のマップのクローンを同じ 1 回の操作の中で合わせる。`neighbors.state` の `clones`（表示中のマップの外にあるクローンの位置 `x`・`y`（主マップの左上が原点で負もある）、人の番号 `index`、描く画像番号 `graphicsId`。#298）と `clonesShown`（帯の上にクローンを描いているか）。比較テストは `setting` で `showClones` を false にしてから比べる。

## Phase3 の部品と命令（接続・描画）

- 隣のマップの帯（#223）: `{"cmd":"neighbors.state","wait":true}` で、見せ方の設定（`view`: `band` / `all` / `off`）、帯の幅（`range`。マップ全体なら null）、隣の一覧（`index`・`direction`・`side`・`bank`・`map`・`offset`・`placement`（隣のマップ全体の置き場所）・`band`（見せる部分。隣のマップの中の座標）・`bandAt`（見せる部分の置き場所）。座標はどれも主マップの左上を (0, 0) としたマス）、主マップのまわりの余白 `margins`、接続のある辺 `connectedSides`、描き終えたか `done`、マップを切り替え始めてから帯を描き終えるまで `neighborsMs`、帯を作るのにかかった時間 `buildMs` を返す。`wait: true` なら描き終えるまで待つ。
- `canvasPng` のマップのタブ（`map` / `movement` / `event`）に `neighbors: true` を付けると、隣のマップの帯と主マップの枠も含めた画像を返す（無ければ主マップだけ）。
- `mouse` のマップのタブの `cell` は主マップの左上が原点。負の値や大きさを超える値で、隣のマップの帯の上を指せる（例: 上の帯の上のダブルクリック `{"cmd":"mouse","target":"map","action":"dblclick","cell":[5,-3]}`）。`px` は今までどおり部品（ステージ）の左上から。
- 見せ方の切り替えはメニューのアクション `neighbors.band` / `neighbors.all` / `neighbors.off`（`{"cmd":"action","id":"neighbors.off"}`）か、`{"cmd":"setting","key":"neighborView","value":"off"}`。比較テストは AdvanceMap と同じ見た目で比べるため、起動のたびに `off` にする。
- 角のつまみ（#229）: `{"cmd":"connection.handles"}` で、表示中のマップの隣の帯のつまみの一覧（`id` は `corner:<接続の番号>:<start|end>`、接続の番号 `index`・向き・相手・ずれ、つまみの中心のマス `at`（主マップの左上が原点、境界の線の上））。ドラッグは `{"cmd":"mouse","target":"connectionHandle","handle":"corner:0:start","action":"drag","cell":[0,0],"to":[3,0]}`（`cell: [0, 0]` がつまみの中心、`to` はマップタブのマス単位のずらし。上下の接続は横、左右の接続は縦の動きだけを読む）。離すと `shiftConnection` を 1 回実行する。
- `shiftConnection` コマンド（`{"cmd":"command","name":"shiftConnection","args":{"bank":3,"map":0,"index":0,"offset":3,"targets":[{"bank":3,"map":0},{"bank":3,"map":19}]}}`）: 自分の接続のずれを変え、`targets` に相手が入っていれば相手の逆向きの接続を `-offset` にそろえる（逆の接続が無ければ自分だけ）。
- 設定 > 接続のずれを相手のマップにもそろえる（アクション `opt.alignConnections`、個人設定 `alignConnections`。既定オン）: コネクションマネージャーの「保存」で、ずれだけを変えた接続を `shiftConnection` にして相手もそろえる。比較テストは AdvanceMap と同じく相手を変えないよう、起動のたびにオフにする。
- 辺のつまみ（#230）: `connection.handles` の `edge:<up|down|left|right>`（主マップの辺の中央。隣のマップを「出さない」にしているときは出さない）。`{"cmd":"connection.menu","side":"right"}` で右クリックのメニューを出して項目（`id`・`label`・`enabled`）を返す。押すのは `{"cmd":"contextMenu.press","id":"newMap"}`。項目の `id`: `newMap`（新しいマップを作ってつなぐ。バンクを聞く入力「新しいマップのバンク」が出る）、`connect`（既存のマップとつなぐ。マップを選ぶ「つなぐマップ」が出る。`dialog` の `input` で絞り込み（`3.19` は完全一致）、`press: "ok"` で先頭か選んだもの）、`remove:<接続の番号>`（接続を消す。確認に `yes`）、`diveNew`・`diveConnect`・`emergeNew`・`emergeConnect`（ダイブ先・浮上先。もう持っていれば押せない）。
- `neighbors.state` の `connections` は主マップの接続の全部（ダイブ・浮上も。`index`・`direction`・`offset`・`bank`・`map`）。
- コマンド（#230）: `connectMaps`（`bank`・`map`・`direction`・`offset`・`targetBank`・`targetMap`。相手に逆向きの接続を足す。相手がもう逆の接続を持っていればずれだけそろえる。ダイブ・浮上は 1 枚に 1 つまで（`diveExists`））、`disconnectMaps`（`bank`・`map`・`index`・`targets`。相手の逆の接続も消す）、`fillLayout`（`bank`・`map`・`cell`。配置を同じ値で埋める）。新しいマップを作ってつなぐのは `group` の `createMap` → `setBorder` → `fillLayout` → `connectMaps`。
- 入力ダイアログ（`inputDialog`）の OK・Cancel は `dialog` の `press: "ok"`・`"cancel"` でも押せる。
- 複数選択の移動許可（#225）: マップから Ctrl＋右ドラッグで拾った選択は、`selection`（とマウス操作の返事）の `block.movements` に移動許可を持つ（パレットから選んだものは持たない）。`selectBlock` に `movements`（`blocks` と同じ並び）を渡すと、マップから拾ったのと同じ選択になる。マップタブの右の欄の「移動許可も貼る」は `map.pasteMovements`（`setField` に true / false。個人設定 `pasteMovements`）。オンなら `paintCells`、オフなら `paintBlocks` で貼る。
- `paintCells` コマンド: `{"cmd":"command","name":"paintCells","args":{"bank":3,"map":0,"cells":[{"x":5,"y":5,"block":9,"movement":12}]}}`（ブロックと移動許可を両方書く。ドラッグ中はまとめて 1 回の操作）。
- コピーと貼り付け: マップタブで `{"cmd":"key","key":"c","ctrl":true}`（コピー）、`mouse` の `hover` でマスを指してから `{"cmd":"key","key":"v","ctrl":true}`（貼る）。
- 矩形塗りと入れ替え（#233）: `mouse` に `alt` を足した。矩形塗りは `{"cmd":"mouse","target":"map","action":"drag","ctrl":true,"cell":[2,2],"to":[6,5]}`（移動エリアタブは `target: "movement"`）、入れ替えは `"alt":true`。取りやめは `down`・`move`（`button: "left"`）のあとに `{"cmd":"key","key":"Escape"}` を送ってから `up`。矩形塗りは選択が移動許可を持ち「移動許可も貼る」がオンなら `paintCells`、そうでなければ `paintBlocks`、入れ替えは `paintCells` の 2 マス。
- 辺のつまみのドラッグでリサイズ（#231）: `{"cmd":"mouse","target":"connectionHandle","handle":"edge:left","action":"drag","cell":[0,0],"to":[-3,0]}`（左へ 3 広げる。`to` はマス単位のずらしで、その辺の外向きが広げる向き）。離すと `group`（`resizeMapEdge` と、プロジェクトがあれば `shiftEventLabelPositions`）を 1 回実行する。`{"cmd":"resize.refs"}` で、最後に左・上をずらしたときに見つけた、直していない `.s` の座標の行（`path`・`line`・`text`・`kind`（`warp` / `object`））を返す。見つかったときは「直していない座標」のダイアログも出る（`dialog` の `press: "ok"` で閉じる）。
- コマンド: `resizeMapEdge`（`bank`・`map`・`side`（`up` / `down` / `left` / `right`）・`amount`（広げるマス数。負なら縮める）・`targets`（自分と、ずれを直す接続の相手））、`shiftEventLabelPositions`（`bank`・`map`・`dx`・`dy`。scripts_MM.json の照合用の座標をずらす）。
- 境界をまたぐ描画（#234）: マップタブ・移動エリアタブの `mouse` の `cell` に帯の上のマス（主マップの外の座標）を渡すと、隣のマップに描く・拾う（帯で見えていない部分では何もしない）。2 枚にまたがる操作は `group`（マップごとの `paintBlocks` / `paintCells` / `paintMovement`）を 1 回実行する。帯が出ている間のドラッグは、境界をまたいでも 1 回の操作にまとまる（`group` 同士をまとめる）。隣のマップは書く前に編集用に読み込む（`cells` は読み込みを待ってから返す）。`{"cmd":"cells","bank":3,"map":19}` で、表示中でないマップの配置を返す。
- Space でダイブ先・浮上先を重ねる（#232）: `mouse` の `hover` でカーソルの位置を決めてから `{"cmd":"key","key":" ","type":"down"}`（押したまま）、`{"cmd":"key","key":" ","type":"up"}`（離す）。`neighbors.state`（`wait: true` で読み込みを待つ）の `dive` が重ねている相手（`id`・`direction`。重ねていなければ null）。`canvasPng` のマップのタブの画像に重ねたものも入る。重ねている間の `mouse` の `dblclick` で相手のマップを開く。


## Phase3 の部品と命令（未使用の番号・ひな形・トレーナー）

- 「未使用」ボタン（#227。プロジェクトフォルダを開いているときだけ出る）: `event.person.flagUnused`・`event.trap.variableUnused`・`event.sign.hiddenIdUnused`（`click` で押す。欄を変えるコマンドを実行する）。
- イベントタブの右クリックのメニューの「ここにひな形を置く」は項目 `placeTemplate`（`mouse` の `rightClick` で開き、`contextMenu.press`）。ウィンドウの部品は `template.kind`（種類のコンボ。項目の文字で選ぶ）、`template.graphics`・`template.flag`・`template.variable`・`template.hiddenId`・`template.item`・`template.amount`・`template.ball`・`template.martItems`（複数選択）・`template.trainer`・`template.sight`・`template.facing`・`template.text.<文の名前>`（`text` / `before` / `after` / `intro` / `defeat`）、未使用のボタン `template.flagUnused` など、新しいトレーナーの `template.newTrainer`（チェック）・`template.newTrainer.id`・`.name`・`.class`・`.pic`・`.seed`・`.generate`・`.party`、「置く」`template.place`・「キャンセル」`template.cancel`（`dialog` の `ok` / `cancel` でも押せる）。

| cmd | 引数 | 動作 |
|---|---|---|
| `usage.state` | `wait`（true で作り終えるまで待つ） | 使われている番号の索引（#227）の状態。`ready`・`building`・`stats`（`ms`: 作るのにかかった時間、`maps`・`asmFiles`・`cFiles`: 読んだ数、`sites`: 使っている場所の数）・`counts`（種類ごとの使用中の番号の数）・`error` |
| `usage.next` | `kind`（`flag` / `var` / `hiddenItem` / `trainer`） | 範囲（`zigzagumap.json` の `usage`）の中で使われていない最小の番号。返事は `kind`・`value`（無ければ null）。作り終えるまで待つ |
| `usage.find` | `kind`、`value` | その番号を使っている場所の一覧 `sites`（`kind`・`value`・`source`（`rom` / `asm` / `event` / `c` / `trainers`）・`where`（`ROM 0x0816A2B4（マップ 3.0）`、`assembly/…/a.s:12`、`maps 3.0 人 2`、`src/x.c:5（FLAG_X）`、`maps/trainers.json（名前）`）・`path`・`line`・`map`）。隠しアイテムの番号はフラグ（0x3E8 + 番号）の場所も入る |
| `template.list` | | ひな形の一覧（`id`・`kind`（置くイベントの種類）・`needs`（ウィンドウで聞くこと）・`texts`（文の名前と既定の文）・`labelKind`（eventscripts の種別）・`nameKind`（ラベル名の `{kind}`）・`defaults`（未使用の番号を入れた既定の値）） |
| `template.place` | `kind`（`person` / `sign` / `tile` / `hiddenItem` / `itemGiver` / `mart` / `trainer`）、`x`・`y`（マス）、`values`（省いた項目は既定値と未使用の番号。`graphicsId`・`movementType`・`flag`・`variable`・`hiddenId`・`item`・`amount`・`ball`・`martItems`・`trainerId`・`sight`・`texts`（文の名前 → 本文）・`newTrainer`（`trainer.get` と同じ形のトレーナー 1 件））、`bank`・`map`（省略で表示中のマップ） | ウィンドウを出さずにひな形を置く（#243・#244・#245。1 回の `undo` で全部戻る）。書き足しが済むまで待つ。返事は `kind`・`map`・`event`（置いたイベントの `kind`・`index`）・`label`（スクリプトの無いひな形は null）・`script`・`strings`（書いた `.s` と `.string`）・`registry`（Chronos の幅検査の登録に足した名前）・`warnings`（同じトレーナーの番号をほかで使っているなど）・`values`（使った値）・`status` |
| `template.picker` | `x`・`y`、`bank`・`map`（省略可） | 「ここにひな形を置く」のウィンドウを出す（答えを待たずに返す。`setField`・`click`・`dialog` で答える） |
| `trainer.list` | `from`・`to`（番号の範囲。省略可） | トレーナーの一覧（#244。ROM の表に `maps\trainers.json` を重ねたもの）。`id`・`trainerClass`・`className`・`name`・`partySize`・`party`（`species`・`level`）・`edited`（trainers.json にあるか）・`uses`（索引で使っている場所の数） |
| `trainer.get` | `id` | 1 件の全部（`partyFlags`・`trainerClass`・`music`・`female`・`pic`・`name`・`items`・`doubleBattle`・`aiFlags`・`party`（`iv`・`level`・`species`、形式により `heldItem`・`moves`））。表の外なら null |
| `trainer.generate` | `seed`、`bank`・`map`（省略で表示中のマップ） | チームの自動生成（#245）。返事は `party`・`seed`・`candidates`（候補にした野生の種族と最高レベル）・`maps`（野生を使ったマップ）。同じ種なら同じ結果 |
| `trainer.json` | | `maps\trainers.json` の中身（`trainers`）、未出力の変更 `modified`、読めなかった理由 `loadError` |
| `trainer.edit` | `id`、または表示中のマップの人 `person`（番号はスクリプトから探す） | トレーナーを直すウィンドウ（#274）を出したまま返す（返事は `id`。`person` で番号が見つからなければ null で、番号を聞く入力が出る）。プロジェクトフォルダが無ければウィンドウを出さず、ステータスバーにエラーを出す |
| `trainer.idForPerson` | `index`（表示中のマップの人） | その人のスクリプトが使うトレーナーの番号（`trainer`・`trainerbattle*`。吹き出しの要約と同じたどり方）。返事は `id`（見つからなければ null） |

- トレーナーを直すウィンドウ（#274）の部品: `trainerEdit.name`・`trainerEdit.class`（コンボ。番号の文字）・`trainerEdit.pic`・`trainerEdit.music`・`trainerEdit.female`・`trainerEdit.item.0`〜`.3`・`trainerEdit.double`・`trainerEdit.ai`・`trainerEdit.party`（「種族 レベル」をカンマで区切る）・`trainerEdit.partyNames`（種族名の表示）、ボタン `trainerEdit.ok`・`trainerEdit.cancel`・`trainerEdit.revert`（trainers.json にあるときだけ）。`dialog` の `press` は `ok` / `cancel` / `revert`。イベントタブの人の右クリックのメニューの項目は `editTrainer`。

trainers.json の編集は `command` の `setTrainer`（`{"trainer": {...}}`。同じ番号が無ければ足す）と `removeTrainer`（`{"id": 700}`）でもできます（元に戻せる）。
- ミキシングバッグ（#236）: `{"cmd":"bag.state"}`（袋の中身 `blocks` と、今の選択に袋を使うか `active`）、`{"cmd":"bag.set","blocks":[13,14,15],"seed":42}`（中身を置き換える。`seed` で乱数の種を決める）。重み（#515）: `bag.state` の `weights` は中身と同じ順の重み（1〜9）。`bag.set` に `"weights":[1,3,1]` を足すと重みも決める（無ければ全部 1）。`{"cmd":"bag.weight","block":14,"weight":5}` で 1 つ変える（袋の欄のホイール・数字キーと同じ。部品の ID はブロックごとに `map.bag.<10 進の番号>`）。ホイールは `{"cmd":"mouse","id":"map.bag.14","action":"wheel","px":[8,8],"delta":-1}`（`mouse` の `action: "wheel"`。`delta` が負なら奥へ回して重みを上げる）。Ctrl＋パレットの左クリックは `{"cmd":"mouse","target":"palette","action":"click","ctrl":true,"cell":[1,0]}`、袋を空にするのは `{"cmd":"mouse","id":"map.bag","action":"click","ctrl":true,"px":[4,4]}`。
- 画像のコピー（#246）: `{"cmd":"image.composite","whole":true,"events":"none","png":true}` で接続している全マップ（`whole: false` なら今のマップ）の画像を作る。`events` は `none` / `persons` / `all`、`scale` で縮める割合（省くと辺が 16,384 画素を超えるときは収まるまで縮める。ダイアログは出さない）。返事は `width`・`height`・`scale`・`bounds`・`maps`（並べたマップと置き場所。最初のマップの左上が原点のマス）・`heapMb`（作っている間の JavaScript のヒープ）と、`png: true` なら PNG（Base64）。`clipboard: true` のときだけクリップボードへ渡す（既定は渡さない。テストでユーザーのクリップボードを汚さないため）。メニューは アクション `image.copyMap.<none|persons|all>`・`image.copyWhole.<none|persons|all>`。


## Phase4 の部品と命令（トリプルレイヤー・描く道具・移植）

命令は `apps/desktop/src/app/automation/` の `tileset`（`blockInfo`）と `pen`（`tripleChildCells`・`autopen.*`）、別ウィンドウの側は `windows/transplant/TransplantWindow.ts` と `windows/map-assist/MapAssistWindow.ts` です。

| cmd | 引数 | 動作 |
|---|---|---|
| `blockInfo` | `block`（通し番号。省略で選んでいるブロック） | ブロックの重ね方（#299）。`attribute`（属性 u32）、`layerMode`（ビット 28〜30 の値 0〜7）、`triple`（トリプルレイヤーか）、`tripleChild`（トリプルレイヤーの次の番号か。1 つ前のトリプルレイヤーのブロックの3枚目のレイヤーのレイヤーに使われている）、`parent`（そのトリプルレイヤーのブロックの番号か null）、`third`（3枚目のレイヤーのレイヤーに使う番号か null）、`unresolved`（トリプルレイヤーだが次のブロックが表の外で3枚目のレイヤーのレイヤーを描けない）、`undrawn`（値 5〜7。実機ではそのマスを描かない） |
| `tripleChildCells` | | 今のマップで、トリプルレイヤーの次の番号（単独では置けないブロック。#301）が置かれているマスの一覧 `cells`（`x`・`y`。表示の設定に関係なく）と、印を描いたマス `marked`（表示 > 3枚目のレイヤーのレイヤーに使われているブロックに印を付ける がオンで、マップタブを見ているとき） |
| `autopen.state` | | オートペン（#310）の設定 `active`・`size`・`movement`・`tint`、今のタイルセットの組のパーツ `parts`（`name`・`kind`・`role`・`order`）、自動で描けるブロックの数 `blocks`、パレットで色を重ねているブロック `tinted`、選んでいるブロックで描くパーツの名前 `part`、見分けたタイルセット `tilesets`（`primary`・`secondary` の `fingerprint`・`headerAddress`）、読んだファイルの数 `files`、読めなかったファイル `problems` |
| `autopen.set` | `active`・`size`・`movement`・`tint`（どれも省略可）、`fraction`（`[fx, fy]` でマスの中の位置 0〜1。null で実際のマウスの位置） | オートペンの設定を変える（個人設定にも入る）。`fraction` は偶数の筆の寄せる側を決める（テスト用）。返事は `autopen.state` と同じ |
| `autopen.save` | `parts`（`maps\autopen\*.json` の `parts` と同じ形） | 今の組のパーツを置き換えて保存する。マップ作成補助のウィンドウに保存していない変更があれば、ウィンドウの一覧にも足す（同じ名前は置き換える。#379）。返事は書いたパス `written` と `autopen.state` |
| （マップ作成補助宛て） | `window`（`map-assist`）と各命令の引数 | ツール > マップ作成補助（#312）のウィンドウで命令を実行する。`state`（`tab`・パーツの一覧 `parts`（`name`・`kind`・`role`・`slots`）・選んでいるパーツ `selected`・枠 `slot`・左で選んだ所 `picked`（`x`・`y`・`width`・`height`・選んだブロックの並び `blocks`。空きは null。#338）・メインの範囲 `range`・未保存 `dirty`・下の帯 `status`）、`fields` / `getField` / `setField`（一覧 `assist.parts` は番号）/ `click`（`assist.add.fill` などのボタン、`assist.slot.<枠名>`）/ `pointer`（`assist.source` の上。`x`・`y` は画素、ブロック一覧は 2 倍）/ `canvasPng`（`assist.source`）/ `close`。`screenshot` も `window` で取れる |
| `transplant.select`（移植のウィンドウ宛て） | `window`（`transplant`）、`bank`・`map`（元の ROM のマップ） | 一覧の番号を探さずに、元の ROM のマップを選ぶ（一覧で選んだのと同じく、絵・情報・変わることの一覧を作り直す）。返事はウィンドウの `state` と同じ |

- コマンド（`command` 命令。どれも元に戻せる）: `setTripleLayer`（ブロックをトリプルレイヤーにする・やめる。N の 8 タイルと属性、N+1 の下のレイヤー 4 タイルを書き、トリプルレイヤーにするときは N+1 の属性と上のレイヤーを 0 にする。表の最後のブロックは失敗。#302）、`addTileset`（新しいタイルセットを加える。移植。#314）、`setLayout`（配置・ボーダー・タイルセットをまとめて差し替える。移植の「配置も写す」）。移植の「取り込む」は `addTileset` と `setLayout` か `setTilesets` の `group` を 1 回実行する。
- ブロックエディタ（`"window": "block-editor"`）のトリプルレイヤーの部品: 3枚目のレイヤーのレイヤーの 4 マス `be.third`（Canvas。`pointer` の `x`・`y` は部品の左上からの画素で、1 マス 16px。左で置く・右で拾う）、見出し `be.thirdLabel`、値 5〜7 の注意 `be.layerWarning`（`getField` の `visible`）。ウィンドウの `state` には `third`（3枚目のレイヤーのレイヤーの 4 タイル）・`triple`・`thirdVisible` が出る。トリプルレイヤーの保存は `setTripleLayer` を通る。
- トリプルレイヤーの印: `action` の `view.tripleChildMarks`（個人設定 `tripleChildMarks`。既定 true）。
- オートペンの欄（マップタブの右）: 「オートペン (P)」`autopen.enable`（`setField` に true / false）、筆 `autopen.size`（コンボ。`1`・`2`・`3`・`5`）、「移動許可も付ける」`autopen.movement`。P キーは `{"cmd":"key","key":"p"}`（マップタブを見ているとき）。パレットの色は `action` の `view.autoPenTint`（個人設定 `autoPenTint`）。
- マップ作成補助（`action` の `tools.mapAssist`、`"window": "map-assist"`）の部品: タブ `assist.tabBlocks`・`assist.tabMap`、左の絵 `assist.source`、パーツの一覧 `assist.parts`（`setField` に番号）、追加 `assist.add.fill`・`assist.add.edge`・`assist.add.piece`・`assist.add.repeat`、`assist.remove`・`assist.up`・`assist.down`、名前 `assist.name`・役割 `assist.role`、「マップから候補を作る（自動）」`assist.analyze`、「Bochi の定義を読み込む…」`assist.importBochi`（ファイルのダイアログは `queuePath` で答える）、枠 `assist.slot.<枠名>`（`assist.slot.NW` など）、「← 左で選んだ所を入れる」`assist.put`・「枠を空にする」`assist.clearSlot`・「保存」`assist.save`、範囲の操作 `assist.fill`（選んだパーツで範囲を塗る）・`assist.tidy`（範囲を整える）とそのチェック `assist.tidyEdges`・`assist.tidyRepeats`・`assist.tidyMovement`（`setField` に true / false）。範囲はメインのマップの `mouse` の `ctrl: true` の右ドラッグで選ぶ。
- 移植のウィンドウ（`action` の `tools.transplant`、`"window": "transplant"`）: 部品は上の `transplant_check.py` の説明のとおり（`tp.pickRom`・`tp.maps`・`tp.parts`・`tp.copyLayout`・`tp.import`・`tp.close`・`tp.preview`・`tp.primaryInfo`・`tp.secondaryInfo`・`tp.report`）と、元の ROM の表示 `tp.romLabel`。ウィンドウの `state` は `rom`・`game`・`mapCount`・`selected`・`selectedSize`（選んだマップの大きさ `[幅, 高さ]`）・`parts`・`copyLayout`・`report`・`conversion`・`target`・`jsHeap`（ウィンドウの JavaScript のヒープ、バイト）。

## Phase5 の部品と命令（ブロックエディタ・パレット・野生。列 2）

確認のスクリプトは `tests/automation/block_tools_check.py`（`--only 393` などで issue ごとに動かせる）。

- ブロックエディタ（`"window": "block-editor"`）のタイルの矩形（#393）: タイル一覧 `be.tiles` の `pointer`（`down` → `move` → `up`。1 タイル 16px）で矩形を選ぶ。選んだ矩形の枠 `be.tilesFrame`（`getField` の `visible`。2 枚以上のときだけ出る）。8 マス `be.block` の `pointer` に `ctrl: true` でパレットだけ塗る、`button: 2` の `down` と `up` で矩形を拾う（離した所が3枚目のレイヤーなら押したマスだけ）。ウィンドウの下の 1 行 `be.status`（`getField` の `value`。ホバーの情報と案内）。ウィンドウの `state` に `selection`（`width`・`height`・`picked`（8 マスから拾った矩形か）。選んでいなければ null）が出る。
- ブロックのコピー・貼り付けと入れ替え（#394）: `action` の `edit.copy`・`edit.cut`・`edit.paste`・`edit.swap`、または `key`（`{"cmd":"key","key":"c","ctrl":true}`、入れ替えは `{"cmd":"key","key":"x"}`）。入れ替えはオンにしてから `be.blocks` を 2 回押し、確かめのウィンドウ（`dialogs`）を `dialog` の `press`（`yes` 付け替える / `no` タイルセットの中だけ / `cancel`）で答える。ウィンドウの `state` に `edit`（`clipboard`（`tiles`・`attribute`・`third`）と `swap`（`active`・`first`））と、ウィンドウの下の 1 行の文 `status` が出る。コマンドは `swapBlocks`（`tileset`・`secondary`・`a`・`b`（タイルセットの中の番号）・`targets`（付け替えるマップ。読み込んでおく））。メインへの頼みは `tilesetUsers`（そのタイルセットを使うマップの一覧）と `swapBlocks`（マップを読み込んでから実行）。
- 使用回数・未使用・ブロック一覧の画像（#395）: `action` の `view.usage`・`view.unusedBlocks`・`view.unusedTiles`（オン・オフ）と `tiles.exportBlocks`（書き出しのウィンドウ）。ウィンドウの `state` に `stats`（切り替え `flags`（`usage`・`unusedBlocks`・`unusedTiles`）、数え終えたか `counted`、一覧の並び（主の 640 個のあとに副）での使用回数 `counts`（表に無い番号は -1）、未使用のブロックの番号 `unusedBlocks`、未使用のタイルの通し番号 `unusedTiles`）が出る（数える前の値は null）。重ねた絵は `be.blocksOverlay`・`be.tilesOverlay`（Canvas）。書き出しのウィンドウの部品: `be.exp.tileset`（0 か 1）・`be.exp.from`・`be.exp.to`（16 進）・`be.exp.lower`・`be.exp.upper`・`be.exp.third`（チェック）・`be.exp.columns`・`be.exp.background`（0 そのまま・1 黒・2 パレット 0 の色 0）・`be.exp.info`（ブロック数と画素の大きさ）・`be.exp.preview`（Canvas）。`dialog` の `press` の `save` で、`queuePath` で積んだパスに書く。メインへの頼みは `blockStats`（`tiles`: 未使用のタイルも数えるか）。
- パレットエディタ（`"window": "palette-editor"`）の Phase5 の部品（#396）: 16 進の RGB の欄 `pal.rgbHex`（`setField`）と `pal.rgbApply`（`click`）、16 色の見本 `pal.color.0`〜`pal.color.15`（`click` で選ぶ）。`action` の `view.unusedColors`（オン・オフ）と `tools.colorUsage`（色の使用箇所のウィンドウ。案内 `pal.usage.info`、行 `pal.usage.<ブロックの通し番号>` を `click` するとブロックエディタで選ぶ。`dialog` の `press` の `close` で閉じる）。ウィンドウの `state` に `rgb`（欄の文字）、`showUnused`、`unusedColors`（未使用の色の番号。オフなら null）が出る。メインへの頼みは `setUi` の `focusBlock`（ブロックエディタで選ぶブロック。閉じていれば開く）。パレットファイルの読み込み（ブロックエディタの `palette.open`）は、`queuePath` で積んだファイルを中身で見分けて読む。
- 新しいタイルセット（#397）: ブロックエディタの `action` の `tiles.newTileset` でウィンドウを開く。部品は `be.nt.kind`（0 タイルセット1・1 タイルセット2）・`be.nt.tiles`・`be.nt.blocks`（10 進）・`be.nt.content`（0 空・1 今のタイルセットの写し）・`be.nt.limit`（上限の案内）。`dialog` の `press` の `create` で作る。メインへの頼みは `newTileset`（`secondary`・`tileCount`・`blockCount`・`copy`。core の `newTilesetCommand` で `addTileset` と `setTilesets` を 1 回の組で実行する）。
- 野生（#398）: 野生ポケモンタブの枠の割合 `wild.slotRate.1`〜`wild.slotRate.12`（`getField` の `value`。「20%」、釣りは「70%（ボロ）」）、グラフのボタン `wild.chart`。グラフのウィンドウの部品は `wild.chart.rod`（釣りだけ）・`wild.chart.species`（0 が全部の種族）・`wild.chart.totals`・`wild.chart.levels`（Canvas。`mouse` の `hover` に `id` と `px`）・`wild.chart.hover`（乗せた棒の値）。`dialog` の `press` の `close` で閉じる。検索は `action` の `tools.wildSearch`。部品は `wild.search.species`（種族の欄。今までどおり番号で `setField` でき、名前・読み・番号の文字も入れられる。名前が 1 つに決まる文字なら決まる。`getField` の `value` は決まった種族の名前。#447）・`wild.search.species.list`（候補の一覧。`getField` の `visible`）・`wild.search.species.item.<n>`（出ている候補の上から n 番目。`value` は名前と番号。`click` で決める）・`wild.search.species.none`（当たる候補が無いときの文）・`wild.search.run`（`click`）・`wild.search.info`・`wild.search.col.0`〜`wild.search.col.4`（見出し。`click` で並べ替え）・`wild.search.row.<n>`（並べた順の行。`mouse` の `dblclick` でそのマップの野生タブを開く）。打って選ぶ操作は、`ui.type`（`"blur": false` で欄から離れずに候補を出したままにする）、欄を `click`（全部の候補を出す）、`key` に `"id": "wild.search.species"` を付けて `ArrowDown`・`ArrowUp`・`Enter`・`Escape` を送る（候補を閉じているときの `Enter` で検索する）。
- 写しでの確認: `python tests/realcopy/run.py --swap --reuse --only nd`（ND の写しで副の 2 つを入れ替えて出力・ビルドし、できた ROM の中身と開き直した絵を確かめる）。

## Phase4 の表示・一覧・調査（列 3）

命令は `apps/desktop/src/app/automation/viewTools.ts` にまとめています。

- イベントの種類ごとの表示（#304）: `action` か `menu.run` の `view.eventKind.person`・`view.eventKind.sign`・`view.eventKind.trap`・`view.eventKind.warp`（個人設定 `hiddenEventKinds` に隠す種類が入る）。イベントの濃さは、表示 > 移動エリアの設定の透明度（`view.opacity`）のウィンドウのスライダー `view.eventOpacity.slider`（`setField` に 10〜100）と値 `view.eventOpacity.value`（個人設定 `eventOpacity`、0.1〜1）。比較テストは `setting` で `hiddenEventKinds` を `[]`、`eventOpacity` を 1 にしてから比べる（既定のまま）。

| cmd | 引数 | 動作 |
|---|---|---|
| `seams.state` | `wait`（true で調べ終えるまで待つ） | 接続の境目の注意（#305）。点検した主マップ `map`、調べ終えたか `done`、崩れるマスのある接続 `issues`（接続の番号 `index`・`side`・相手 `id`・マスの数 `count`・マス `cells`（主マップの左上が原点））、ステータスバーの注意の文 `status`（出ていなければ null）、主マップのタイルセット `tilesets` と上下左右の接続の相手のタイルセット `connections`（`index`・`bank`・`map`・`primary`・`secondary`。ポインタの値） |
| `town.state` | `wait`（true で読み込みを待つ） | タウンマップのウィンドウ（#306・#386）。出しているか `open`、読み込み済みか `loaded`、面 `page`、今のマップの地名 `region`、枠 `frame`（今の面のタウンマップのマス `x`・`y`・`width`・`height`。面が違うか無ければ null）、枠をどこから出したか `source`（`map` = マップだけの紐づけ、`section` = 地名の紐づけ、`rom` = ROM のデータ、どれにも無ければ null）、面も含めた位置 `at`（`page`・`x`・`y`・`width`・`height`。無ければ null）、紐づけの一覧 `links`（`sections`: `region` と範囲、`maps`: `bank`・`map` と範囲）、保存先 `store`（`project` = `zigzagumap.json`、`personal` = 個人設定の `townLinks`）、`zigzagumap.json` を読めなかった理由 `storeError`（読めれば null）、右ドラッグやメニューで選んでいる範囲 `selection`（無ければ null）、マウスの下の地名 `hovered`、下の欄の文 `label`。ウィンドウを作っていなければ `open: false` だけ |
| `town.pick` | `x`、`y`（タウンマップのマス） | ウィンドウのマスを押したのと同じ（地名があれば一覧を `場所:<番号>` で絞る。地名を紐づけた範囲なら紐づけた地名）。返事は `region` と絞り込みの欄の文 `filter` |
| `town.link` | `scope`（`section` = 今の地名（既定）/ `map` = 今のマップだけ）、`x`・`y`（タウンマップのマス）、`width`・`height`（既定 1）、`page`（省略で今の面） | 右クリックのメニューの「ここに紐づける」と同じ。すぐ保存する（取り消しの対象にしない）。ウィンドウを出していなければ出す。範囲がタウンマップの外か、`section` で今のマップに地名が無ければエラー。返事は `town.state` と同じ形 |
| `town.unlink` | `scope`（`section`（既定）/ `map`） | 今の地名か今のマップの紐づけを外す。返事は外したか `removed`（無ければ false）と `town.state` |
| `pointers.state` | | ポインタ一覧（#307）。開いているか `open`、上の説明 `note`、一覧 `rows`（`kind`・`index`・`location`・`value`・`bytes`）、選んでいる行 `selected`（無ければ -1）、最後の検索 `last`（`value`・`rom`・`hits`（`offset`・`place`）・`ms`・`chunks`）、最後にコピーした文字 `lastCopied`（自動操作で起動したときはクリップボードへ書かず、ここに残す） |
| `pointers.search` | `address`（ROM の上の位置かポインタの値。数）、`rom`（ほかの ROM のパス。省略で開いているベース ROM） | ウィンドウを開いて参照元を探す。返事は `last` と同じ形と、探している間のいちばん長い画面の止まり `maxGapMs` |
| `pointers.select` | `row` | 一覧の行を押したのと同じ（イベントの行ならイベントタブで選ぶ）。返事は `selected` |
| `recent.state` | | 最近使ったブロック（#308）。`blocks`（新しい順の番号）と、それぞれの持ち主のタイルセット `tilesets`（ポインタ） |
| `thumbs.state` | `wait`（true で作り終えるまで待つ） | マップ一覧のサムネイル（#315）。設定でオンか `enabled`、作っている最中か `running`、作り終えたマップの数 `maps`、作った絵の数 `images`、全部を作るのにかかった時間 `ms`、一覧でサムネイルを描いた行の数 `rows`（開いている枝の分だけ） |
| `zoom.state` | `tab`（`map` / `movement` / `event`。省略で `map`） | マップの拡大（#316）。倍率 `zoom`、描く大きさ `cellSize`、画面の上の大きさ `screenCellSize`、CSS で広げる割合 `scale`、重ね描きの Canvas の画素数 `layer`、スクロールの大きさ `scrollSize` と位置 `scroll`、個人設定 `mapZoom` |
| `zoom.wheel` | `tab`、`cell`（主マップの左上が原点のマス）、`delta`（負で拡大、正で縮小。既定 -1） | そのマスの上で Ctrl＋ホイールを回したのと同じ。返事は `zoom.state` と、回したあとの同じマスの画面の上の位置 `at` とずれ `drift`（画素） |
| `catalog.get` | `bank`、`map` | マップ一覧の情報（地名の番号 `region`・配置の番号 `layoutId`・名前 `name`・タイルセットの番号）。無ければ null |

- ステータスバーの注意は `status.seams`（`click` で一覧のダイアログ「接続の境目の注意」を出す。`dialog` の `press: "ok"` で閉じる）。
- マップ一覧の絞り込み（#305）: `tree.filter` の `text` に `場所:58,7E`（地名の番号、16 進）・`地形:9`（配置の番号、16 進）を書ける。名前の語と並べて使える。
- タウンマップのウィンドウ（#306）: `action` か `menu.run` の `view.townMap`（個人設定 `showTownMap`）。ウィンドウの ID は `town`（`ui.shot` で撮れる）、絵は `town.canvas`（`canvasPng` の `id`、`mouse` の `id` と `px`。マスの左上は `px` で (32 + x×8, 32 + y×8)）、面のコンボ `town.page`、下の欄 `town.label`。
- タウンマップの紐づけ（#386）: 右クリックのメニューは `mouse` の `id: "town.canvas"` に `action: "rightClick"`（1 マス）か `action: "drag"`・`button: "right"`（`px` から `toPx` までの範囲）で出す。項目は `contextMenu.state` で読み、`contextMenu.press` の `id` で押す（`town.linkSection` = 今の地名をここに紐づける、`town.linkMap` = 今のマップだけをここに紐づける、`town.unlinkMap`・`town.unlinkSection` = 紐づけを外す。外す項目は紐づけがあるときだけ出る）。押したあとの保存は少し後に終わるので、`town.state` の `links` で確かめる。保存先はプロジェクトフォルダを開いていれば `zigzagumap.json` の `"townMap"`、ROM だけなら個人設定の `townLinks`（ROM の小文字のパスが鍵。`--profile` のフォルダの settings.json）。`maps\regionmap.json` と ROM には書かない。
- ポインタ一覧（#307）: `action` か `menu.run` の `tools.pointers`（Ctrl+Shift+P）。ウィンドウの ID は `pointers`（`ui.shot` で撮れる）、一覧 `pointers.list`・行 `pointers.row.<番号>`（`mouse` の `rightClick` で右クリックのメニュー。項目 `copyValue`・`copyBytes`・`copyLocation`）、アドレス `pointers.address`、ROM の選び方 `pointers.rom`（`base` / `other`。`other` はファイルのダイアログを出す）、「探す」`pointers.search`、結果の文 `pointers.status`・一覧 `pointers.results`（行 `pointers.result.<番号>`）、「閉じる」`pointers.close`。
- パレットの情報（#308）: ブロックパレット（`mouse` の `target: "palette"` の `hover`）と移動許可のパレット（`target: "movementPalette"`）に乗せたときの情報は、ステータスバーの補助の欄 `status.info`（`getField`）。移動許可は選んだときも出る。最近使ったブロックの欄は `map.recent`（`ui.shot`）、絵は `map.recent.canvas`（`mouse` の `id` と `px`。1 件 16px、間 2px。トリプルレイヤーは 32px）。タイルセット 1・2 の境目の線と見出しは #545 で外した（個人設定に残った `paletteBoundary` は読まない）。
- マップ一覧のサムネイル（#315）: `action` か `menu.run` の `view.treeThumbnails`（個人設定 `treeThumbnails`。既定 false）。行の縮小は `canvas.tree-thumb`。
- マップの拡大（#316）: `mouse` のマップのタブの `cell` は、拡大していても画面の上のマスの大きさで押す。中ボタンのドラッグはスクロールの枠 `map-tab-view`・`movement-tab-view`・`event-tab-view`（`mouse` の `id`）に `"button": "middle"` の `drag` で送る（ステージに送ると、スクロールで部品が動いて量が合わない）。メニューの `zoom.map` などは 1 倍・2 倍の切り替えで、個人設定 `mapZoom` のそのタブの値を 0 に戻す。

## Phase5 の部品と命令（描く道具と表示。列 1）

命令は `apps/desktop/src/app/automation/tools.ts` にまとめています。

| cmd | 引数 | 動作 |
|---|---|---|
| `tool.state` | | 今の道具 `tool`（`pencil` / `fill` / `shift` / `select`。個人設定 `paintTool`）、スマートパスの設定 `smartPath`（個人設定 `smartPath`）と、今の選択で使えるか `smartPathReady`（3×3 のときだけ）、マップタブの帯で押されているボタン `buttons`、帯が画面にあるか `strips`（`map`・`movement`）、鉛筆のブラシ `brushSize`（1〜9）・`brushShape`（`square` / `circle`）と、今使うか `brushActive`（`map`・`movement`。#515） |
| `tool.set` | `tool`（`pencil` / `fill` / `shift` / `select`）、`smartPath`（true / false）、`brushSize`（1〜9）、`brushShape`（`square` / `circle`）。どれも省略可 | 道具・スマートパス・ブラシを変える（帯のボタンと欄、N・B・S・M・`[` `]` と同じ。個人設定に覚える）。返事は `tool.state` と同じ |
| `tool.fill` | `cell`（`[x, y]`。主マップの左上が原点。隣の帯の上も指せる）、`magic`（true でマジック塗り）、`tab`（`map` / `movement`。省略で表示中のタブ） | 塗りつぶしを 1 回行う（道具の設定は変えない）。返事の `count` は塗ったマスの数と、`selection` と同じもの |
| `select.state` | `tab`（`map` / `movement`。省略で表示中のタブ） | 範囲の選択（#516）。今の選択 `rect`（`[x, y, 幅, 高さ]`。無ければ null） |
| `select.move` | `rect`（`[x, y, 幅, 高さ]`）、`dx`、`dy`、`tab` | 矩形を選んで `dx`・`dy` だけ動かす（選択の道具でドラッグして離したのと同じ 1 回の操作。マップの端で止める）。道具の設定は変えない。返事は動かした量 `moved`（`[dx, dy]`。動かなければ null）、動かした後の選択 `rect` と、`selection` と同じもの |
| `tool.shift` | `dx`、`dy` | 表示中のマップをずらす（マップシフトのドラッグを離したときと同じ 1 回のコマンド `shiftMap`） |
| `tool.resize` | `left`・`right`・`up`・`down`（広げるマス数。負なら縮める）、`fill`（`edge`（既定。端の写し）/ `border`（境界ブロック）/ `selection`（選んでいるブロック）） | 対話式リサイズのウィンドウの OK と同じ。返事は実行できたか `done`、変えたあとの大きさ `width`・`height`、開いているダイアログ `dialogs`（できなかったときはエラーのダイアログを出したまま、3 秒待たずに返す） |
| `tool.resizeDialog` | | 対話式リサイズのウィンドウ「マップの大きさと位置」を開いてすぐ返す。返事は `dialogs` |
| `view.aids` | | 表示の補助（#391）。カーソルの枠 `cursorFrame` とプレイヤーの視界の枠 `playerView`（個人設定）、グリッドの表示 `grid` と形 `gridStyle`（`width`・`height`・`offsetX`・`offsetY`（マス）・`color`・`line`）、タブごとの枠 `layers`（`map`・`movement`・`event` の、マウスのマス `cell` と枠のマスの矩形 `cursor`・`sight`。出していなければ null。`cursorCells` はカーソルの枠の中で描くマスの数で、円のブラシのときは矩形より少ない）、移動許可の数値の欄の文字 `movementValue` |
| `shortcuts.state` | | ショートカットの変更（#392）。今のキー `keys`（操作の ID → 表記。2 つなら「、」で区切る。無ければ空）と、個人設定に残す形 `overrides`（既定と違う操作だけ） |

- 道具の帯（マップタブと移動エリアタブの右の欄の上）: ボタン `tools.map.pencil`・`tools.map.fill`・`tools.map.shift`（移動エリアタブは `tools.movement.*`）、スマートパスのチェック `tools.smartPath`（`setField` に true / false）。N・B・S は `{"cmd":"key","key":"b"}` のように送る（マップタブか移動エリアタブを見ているとき）。
- 道具を選んでから `mouse` で使う: 塗りつぶしは `click`（`ctrl: true` でマジック塗り）、マップシフトは `drag`（`shift: true` で横か縦だけ。途中で `{"cmd":"key","key":"Escape"}` を送るとやめる）、直線は鉛筆の `drag` に `shift: true`。
- 対話式リサイズのウィンドウの部品: 幅 `resize.width`・高さ `resize.height`・左に足す `resize.left`・上に足す `resize.top`（どれも `setField` に数の文字）、埋め方 `resize.fill`（`setField` に 0 端の写し / 1 境界ブロック / 2 選んでいるブロック）、図 `resize.view`（`ui.shot`。マップをドラッグして位置を決める）、変わる量か入力の問題 `resize.info`（`getField`）。`dialog` の `press: "ok"` で実行、`"cancel"` で閉じる。入口は場所の設定タブのかんたん表示の `easy.resizeDialog` と、辺のつまみの右クリックのメニューの `resize`（`contextMenu.press`）。
- 表示の補助（#391）: `action` か `menu.run` の `view.cursorFrame`（C）・`view.playerView`（V）・`view.gridSettings`（ウィンドウ「グリッドの設定」を開いてすぐ返す）。ウィンドウの部品は `grid.width`・`grid.height`・`grid.offsetX`・`grid.offsetY`（`setField` に数の文字）・`grid.color`（`#rrggbb`）・`grid.line`（`setField` に 0 実線 / 1 破線 / 2 点）・`grid.reset`（既定に戻す）。`dialog` の `press: "ok"` でグリッドを出して覚え、`"cancel"` で元に戻す。枠は `mouse` の `hover` で動く（`view.aids` の `layers`）。移動許可の数値の欄は `movement.value`（`setField` に 16 進 2 桁。00〜3F の外は選択を変えない）。
- ショートカットの変更（#392）: `action` の `opt.shortcuts` でウィンドウ「ショートカットの変更」を開く。キーの欄は `shortcuts.<操作の ID>.0`・`shortcuts.<操作の ID>.1`（`click` してから、`key` 命令に `id` でその欄を渡して押す）、外す `shortcuts.<操作の ID>.<n>.clear`、既定に戻す `shortcuts.reset`（`click`）。重なるとウィンドウ「キーの重なり」が出るので、`dialog` の `press: "new"`（新しく決めた方に残す）か `"old"`（前からの方に残す）で答える。`dialog` の `press: "ok"` で決め、`"cancel"` で閉じる。操作の ID は `apps/desktop/src/app/keymap.ts` の表。
- コマンド（`command` 命令。どれも元に戻せる）: `shiftMap`（`bank`・`map`・`dx`・`dy`。配置全体のブロックと移動許可をずらし、はみ出た分は反対側へ回す）、`resizeMapEdge` の `fill`（`width`・`height`・`cells`（u16）・`ox`・`oy`。広げた所を端の写しでなくこの柄で埋める）。

## Phase6 の部品と命令（画像からタイルとブロックを作る。#440〜#446）

命令は `apps/desktop/src/app/automation/tileset.ts`、計算は core の `packages/core/src/tileset/import/` です。

| cmd | 引数 | 動作 |
|---|---|---|
| `tileset.importImage` | `paths`（PNG のパス 1〜3 個。下のレイヤーから順。1 つなら `path` でもよい）、`target`（`secondary`（既定。今の副）/ `primary`（今の主）/ `newSecondary` / `newPrimary`（新しいタイルセットを作り、表示中のマップの組を付け替える））、`transparent`（透明色の BGR555。省略で 1 枚目の左上の画素、`null` で使わずアルファ値だけで決める）、`options`（下の表）、`stamp`（スタンプの名前。省略で作らない） | 表示中のマップの組で計画を作り、問題が無ければ 1 回のコマンド（`group`。今あるタイルセットなら `setTiles`・`setPaletteColors`・`setBlockData`、新しいタイルセットなら `addTileset`・`setTilesets`）で書く。1 回の `undo` で戻る。書いた後は最初のブロックを選ぶ（最近使ったブロックにも入る）。返事は書いたか `done`、計画のまとめ `plan`（`ok`・`paletteShortage`・`problems`・`tiles`・`blocks`・`palettes`・`reduction`・`cellsWide`・`cellsHigh`・ブロックごとの置く番号 `locals`・マスごとの通し番号 `cells`（ブロックにしないマスは -1）・`firstBlock`・計画の時間 `ms`）、書いたタイルセットのポインタ `pointer`、作ったスタンプの名前 `stamp`（同じ名前があれば「名前 (2)」）、全体の時間 `ms`。問題があれば `done: false` で何も変えない |

`options`（どれも省略できる）:

| 項目 | 既定 | 意味 |
|---|---|---|
| `useFlip` | true | 反転で同じになるタイルをまとめる |
| `reuseExisting` | true | 今あるタイル（副へ入れるときは主のタイルも）を使い回す |
| `skipEmpty` | true | 全部が透明の 16×16 はブロックにしない |
| `mergeSame` | true | 同じ 16×16 は 1 つのブロックにする |
| `mode` | `picture` | 1 枚の画像の重ね方。`picture`（絵だけ。下のレイヤー）/ `under`（下地の上に重ね、プレイヤーの下に描く。属性のレイヤーの種類 1）/ `over`（下地の上に重ね、プレイヤーより手前） |
| `upperBehind` | false | 2 枚の画像で、上のレイヤーもプレイヤーの下に描く（レイヤーの種類 1） |
| `baseBlock` | null | 下地ブロックの通し番号（`under`・`over`。下のレイヤーと属性を写す） |
| `reduce` | false | 本（パレット）が足りなければ減色する |
| `excludedPalettes` | [] | 使わない本の番号 |
| `reserveDoorTiles` | true | 副へ入れるとき、ドアのアニメが使う通し番号 1016〜1023 のタイルを空ける |
| `placement` | [] | 手で決めた置き場所（`[ブロックの番号, タイルセットの中の番号]` の並び。#446） |
| `allowReplace` | false | 手で決めた置き場所で、使っているブロックや中身のあるブロックの置き換えを許す |

`problems` の `code`: `palettesShort`（本が足りない。`needed`・`free`・`short`、`atLeast` が 1 なら `needed` は下限）・`overColorTiles`（1 枚で 15 色を超えるタイル）・`tilesShort`・`blocksShort`（`needed`・`free`・`short`）・`noBlocks`・`baseSecondary`（主へ入れるのに副のタイルかパレットを使う下地）・`baseMissing`・`placementInvalid`（`block`・`local`・`problem`: `zero` / `tripleChild` / `outside` / `used` / `notEmpty` / `taken` / `noNext`）は書き込めない誤り（`level: "error"`）。`padded`（16 の倍数に埋めた）・`doorTiles`・`baseUpper`（下地の上のレイヤーは使わない）・`reduced`（`changed`・`before`・`after`）・`replaced` は知らせ（`level: "note"`）。

写しでの確認: `python tests/realcopy/run.py --tileimport --reuse`（見本の PNG を 3.0 の副と 3.1 の新しい副へ取り込んで塗り、出力してビルドし、できた ROM の絵が出力の前と同じことを確かめる）。


取り込みウィザードの下地選択は `ti.mode`（1 下地の上・主人公の下、2 下地の上・主人公より手前）と `ti.pickBase` で開きます。`ti.picker` に `pointer` を送り、ダイアログの `ok` で決定します。`ti.base` の16進番号による入力も使えます。

置き場所の `ti.place.source` と `ti.place.target` は1マス32画素です。左で選んだマスから右へドラッグし、形を保って配置します。`ti.allowReplace` で使用中のブロックへの置き換えを許可し、`ti.autoPlace` または `ti.resetPlace` で自動配置に戻せます。`tileImport.wait` の結果の `plan.locals` はブロックごとの配置番号、`firstBlock` は最初の通し番号です。

## Phase6 の部品と命令（時間帯と野生。P6-C1）

命令は `apps/desktop/src/app/automation/timeOfDay.ts` にまとめています。確認のスクリプトは `tests/automation/time_of_day_check.py`。

| cmd | 引数 | 動作 |
|---|---|---|
| `view.timeOfDay` | `time`（`morning` / `day` / `evening` / `night`）か `settimeofday`（Chronos の値。0 昼・1 朝・2 夕・3 夜・4 深夜。深夜は夜にする）。どちらも省けば切り替えない。`wait`（true で隣の帯を描き終えるまで待つ） | 時間帯ビューア（#434）。返事は、切り替えられたか `ok`（読めないときは false で昼のまま）、今の区分 `time`、区分の並び `times`、読めなかった理由 `error`、区分の代表の時刻 `sections`（`id`・`hour`・`minute`。昼のままなら null）、時刻の元 `clock`（`chronos` / `rtc`）、表示中のマップの色が変わるか `mapTinted`（屋内などは false）、使った色 `fade`（`color`（BGR555）・`amount`（係数）・`halve`（Chronos の朝の半分の計算か）。昼は null）、最後の切り替えで主マップを描き直した時間 `switchMs`、ツール欄のコンボ `combo`（`value`・`disabled`）、ステータスバーの文 `status` |

- メニューの項目は `time.morning`・`time.day`・`time.evening`・`time.night`（`action` か `menu.run`。`menu.list` の `checked` で今の区分が分かる）。ツール欄のコンボは `toolbar.timeOfDay`。
- スクリプトの再生（P6-A）で Chronos の `settimeofday`（0x2D）を再現するときは、`app.timeOfDay.set(区分)` か、値を区分に直す `app.timeOfDay.chronosTime(値)` を使う（この命令と同じ）。


### 野生の時間帯（#436）

プロジェクトを開き `tab {name: "wild"}` の後、`click {id: "wild.time.0"}`（朝）・`.1`（昼）・`.2`（夕）・`.3`（夜）で切り替えます。`wild.timeInfo` は表の無い時間帯の案内、`wild.timeCopy` は昼の表の複製、`wild.timeCreate` は空の表の作成ダイアログ、`wild.timeRemove` は今の表の削除です。昼の削除ボタンは出ません。通常の編集欄は今の時間帯に対して働きます。

`command {name: "setWildTable", args: {bank: 3, map: 19, time: 3, from: 1, remove: false}}` で昼から夜へ複製できます。`remove: true` は指定の時間帯の表を削除します。履歴に1件として入り、`undo` で戻ります。

`wild.search.time` は0が全時間帯、1〜4が朝・昼・夕・夜の絞り込みです。検索結果の6列目が時間帯です。`mouse {id: "wild.search.row.0", action: "dblclick", px: [4, 4]}` で、そのマップの該当する時間帯へ移動します（#437）。


### 人物のコマの描画（#468）

`preview.player {enabled?, player?: {x?, y?, gender?, facing?}}` は仮の主人公を置く・動かす・終了する命令です。`gender` は `male` / `female`、`facing` は `down` / `up` / `left` / `right`。返事は `enabled`、`player`、`frame` です。`preview.playback {state: PlaybackState | null}` は同じ描画口に再生状態を渡し、nullで仮の配置へ戻します。`canvasPng {id: "preview.event.frame"}` などで240×160の画像を取得できます。`action {id: "preview.save"}` は画面と同じPNGを保存します。

`npc.motion {enabled?, seed?}` は表示 > 人物を動かす（#471）を始める・やめる命令です。`seed` は乱数の種（既定0。同じ種なら同じ動き）。`npc.advance {frames}` は時計を使わずに進めて描きます（止めていても進むので、テストで決まったフレームの状態を作れます）。`npc.hold {owner, on}` は owner の名前で人物の動きを止める・解除します。`npc.state` を含め、返事は `enabled`、`frame`、`seed`、`holders`（止めている相手。マップの見えないタブでは `hiddenTab`）、`clock`（`running`: requestAnimationFrame を予約しているか、`frames`、`subscriptions`）、`actors`（`localId`・`movementType`・`x`・`y`・`facing`・`pixelX`・`pixelY`・`movementId`・`visible`・止めて見せる理由 `reason`: `still` / `copy` / `hide` / `unsupported` / `unknown`、動いていれば null）、`missing` です。`cost` は時計から進めた回数と、計算・描画にかかった時間の合計（ms）です。動く人物だけのレイヤーは `npc.image` で1枚のPNG（マップと同じ等倍の大きさ）にして取得できます。`clock.probe {on}` は何もしない購読で時計だけを回し、時計そのものの負荷を測るときに使います。

`follower.state` は仮の主人公の連れ歩き（#476・#477）の状態を返します。返事は `status`（`enabled`、無効なら `reason`: `noProject` / `noSource` / `disabled` / `noDpe` / `noSheets`）、`enabled`、`species`、`shiny`、`female`、`speciesCount`（絵のある種族の数）、`position`（`x`・`y`・`facing`）、`busy`（歩いているか）、`sheet`（`path`・`big`・`fallback`・`sideOffset`）です。`follower.set {enabled?, species?, shiny?, female?}` で表示と見た目を変えます。`follower.advance {frames}` は時計を使わずに歩きを進めます。仮の主人公を置いていないときは何も出しません。欄の部品は `follower.enabled`・`follower.species`・`follower.shiny`・`follower.female`、理由の文は `follower.note` です。

`npc.ranges {enabled?}` は表示 > 人物の移動範囲と視界（#472）を出す・消す命令です。返事は `enabled`、`rules`（`cfru`、`nonTrainerSpotting`）、`persons` です。`persons` の各項目は `localId`、`range`（`x0`・`y0`・`x1`・`y1`。範囲の無い人物は null）、`spotter`（`kind`: `trainer` / `npc`、`allDirections`、`range`。見つけない人物は null）、`rays`（向きごとの `direction`、見つかるマス `tiles`、遮ったマスと理由 `blocked`: `{x, y, hit}`。`hit` は `attribute` / `height` / `object`）です。重ねた絵は `canvasPng {id: "npc.ranges"}` で取得できます。

`actors.scene {actors, x?, y?, width?, height?}` は表示中のマップの前景・人物・影を合成します。座標はマップ画素、既定の範囲は(0,0)から240×160です。`png`、読めなかった人物の `missing`、対応していない重ね方の `unknownBlocks` を返します。画面と保存で同じ合成を使います。

`actors.render {actors, mapType?}` は `PlaybackActorState` の配列（64件まで）を共通描画部品で240×160の透明なCanvasに描き、`png`（base64）と各人物の `frames` を返します。座標はマップ画素です。`frames` の `reason` は非表示なら `hidden`、画像情報が無ければ `graphics`、アニメーションを読めなければ `animation` です。マップ・ROM・履歴を変えません。

### タイルアニメとドア（#473・#474）

どれもマップ・ROM・履歴を変えません。フレームの数え方は、MapBGanimeMain を呼んだ回数（マップに入った直後が0）です。ドアの命令も同じ数え方で、同じフレームでは命令がタスクより先に動きます。マップやROMを切り替えると止まり、命令も消えます。

- `tileAnim.info`: 表示中のマップの主・副のアニメ。`reason` は読めたら null、関数が0なら `none`、知らない関数なら `unknown`、コードが素のBPRJと違えば `code`、絵の表が壊れていれば `data`。`tracks` は名前・転送先のタイル・枚数・周期・余り・コマ数。`bytes` は読んだ絵と表示用の写しのバイト数。
- `tileAnim.frame {frame: number | null}`: フレームを渡します。null で止めて元の絵へ戻します。返事の `shown` は各アニメの表示中のコマ（まだ差し替えていなければ null）。
- `tileAnim.clock {on?, tick?}`: 表示 > タイルアニメを動かす のオン・オフ（`on`）と、時計の代わりに進める（`tick` フレーム）。返事は `on`・`frame`・購読の有無（`subscribed`）・止めている相手（`holders`。画面が無い間は `hidden`、再生中は `playback`）・時計の `clock`（`running` など）。
- `tileAnim.scene {frame?, x?, y?, width?, height?, actors?}`: そのフレームの合成画像（既定は(0,0)から240×160）を `png` で返します。`frame` を渡すとそのフレームに合わせます。
- `door.list`: 表示中のマップのドアのマス（`x`・`y`・`blockId`・`tall`）。`door.info {x, y}` は1マスの結果で、`reason` は挙動が0x69でなければ `behavior`、表に無いブロックなら `unknownDoor`。
- `door.run {kind, x, y, frame?}`: `kind` は `open`・`close`（アニメあり。opendoor・closedoor）、`setOpen`・`setClosed`（アニメ無し。opendoor2・closedoor2）。返事の `lastFrame` はタスクが消えるフレーム。動いている間の `open`・`close` は `reason: "busy"` で何もしません。
- `door.state {frame?}`: そのフレームの描き替えたマス（`at` と8個のタイル指定）、`task`、命令ごとの結果。`door.wait {frame}` は、そのフレームで waitdooranim を実行したときに続けるフレーム。`door.clear` は命令を消します。

再生では、ドアの命令がタイムラインの印に入り、waitdoor の印は続きのフレーム（`until`）を持ちます。`playback.layout` の `waits` が帯の位置です。再生中の `door.state` は再生のドアの命令で計算します。

`tests/automation/tile_animation_check.py --rom <BPRJ> --exe <exe> [--project <ND>] [--shots <フォルダ>]` で確かめます（`--project` のときは再生のドアも確かめます）。

### 天候のプレビュー（#498）

どれもマップ・ROM・履歴を変えません。仮の主人公の画面（表示 > 仮の主人公を置く）に重ねます。

- `weather.state`: `entry`（表示しているか・選んだ天候 `"map"` か 0〜14）、`weather`（今プレビューする中の番号）、`status`・`next`（今の天候と切り替え先）、`frame`（進めたフレーム）、`screen`（段 `evy` と半透明の係数 `eva`・`evb`）、`objects`（描く絵の数）、`problem`（「この天候はプレビューできません」の文。表示できれば null）、`graphicsBytes`（読んだ絵のバイト数）、`ashIsSandstorm`・`whiteSandstorm`（7 番が白い砂嵐か・その色を読めたか）、時計の購読（`subscribed`・`holders`）、再生のフレーム（`playback`）、時計の `clock`。
- `weather.set {weather?, on?, seed?}`: プレビューする天候を選び（`"map"` か 0〜14）、表示のオン・オフを切り替えます。`seed` は雪・雷・泡の乱数の種（オンにするときだけ）。
- `weather.tick {frames}`: 時計の代わりに進めます（再生中は何もしません）。

メニューは `view.weather`（天候を表示する）と `view.weatherPick.map`・`view.weatherPick.0`〜`view.weatherPick.14`（プレビューする天候）です。再生の天候の命令は、タイムラインの `weather` の印（`weather.command` は `reset`・`set`・`do`、`weather.value` は setweather の値）になります。

`tests/automation/weather_check.py --rom <BPRJ> --exe <exe> [--project <ND/Chronos>] [--shots <フォルダ>] [--name <写真の名前>] [--map <バンク.マップ>]` で確かめます（`--project` のときは時間帯との重なりと再生の命令も確かめます）。

### DPE の種族名（#439）

野生タブやトレーナー編集の初回に名前表を読みます。`getField {id: "wild.species.1"}` の `options` が種族数です（ND 970件、Chronos 1573件）。`setField` は従来どおり種族番号を指定します。`tests/realcopy/run.py --species --reuse` で追加種族の選択、JSON出力、開き直し、トレーナーの名前の表示を確認できます。


### 画像の時間帯（#435）

`image.composite` は `time: "morning" | "day" | "evening" | "night"` を受けます。省略すると表示中の時間帯、指定すると書き出しだけにその色を使います。`mapExport.time` のコンボは0朝・1昼・2夕・3夜です。`mapExport.state` の `choice.time` に選択が出ます。プロジェクトを開いていないときは昼のままでコンボは無効です。
