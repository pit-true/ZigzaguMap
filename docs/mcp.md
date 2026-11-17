# MCP サーバー

Claude Code や Claude Desktop などの AI のアプリから、ZigzaguMap のマップを読み書きするための MCP サーバーです。MCP（Model Context Protocol）は、AI のアプリが外の道具を呼ぶための決まりです。

MCP サーバーは exe の外にある 1 つのファイル `zigzagumap-mcp.mjs` で、Node.js 22 以降で動きます。AI のアプリが子プロセスとして起動し、標準入出力（stdio）でやり取りします。MCP サーバー自身はネットワークで待ち受けません。

[しくみ](#しくみ) / [準備](#準備) / [AI のアプリに登録する](#ai-のアプリに登録する) / [許可](#許可) / [道具の一覧](#道具の一覧) / [安全のための作り](#安全のための作り) / [開発](#開発)

## しくみ

開いている ZigzaguMap につないで使います。AI が行った書き換えは画面にすぐ出て、ZigzaguMap の「元に戻す」（Ctrl+Z）でも戻せます。出力するまでファイルは変わりません。

```
AI のアプリ ─stdio─ zigzagumap-mcp.mjs ─127.0.0.1（合言葉つき）─ ZigzaguMap
```

ZigzaguMap の 設定 > MCP の窓口 >「MCP の窓口を開く」をオンにすると、ZigzaguMap は 127.0.0.1 の空いているポートで待ち受け、ポートと合言葉を `%APPDATA%\io.github.pit-true.zigzagumap\mcp.json` に書きます。MCP サーバーは道具を呼ばれるたびにこのファイルを読んでつなぎます。ZigzaguMap を閉じるか、窓口をオフにすると、ファイルは消え、ポートも閉じます。

ZigzaguMap を起動していないときや窓口がオフのときは、道具を呼ぶとその旨の文が返ります。

## 準備

1. Node.js 22 以降を入れます。
2. `zigzagumap-mcp.mjs` を置きます。リリースに exe と並べて添えています。リポジトリから作るときは次のとおりです（`tools/mcp/dist/zigzagumap-mcp.mjs` ができます）。

   ```sh
   pnpm install
   pnpm --filter @zigzagumap/mcp build
   ```

3. ZigzaguMap で ROM とプロジェクトフォルダを開き、設定 > MCP の窓口 >「MCP の窓口を開く」をオンにします。設定は覚えるので、次からは起動するだけで窓口が開きます。

## AI のアプリに登録する

Claude Code では、次のコマンドで登録します（パスは置いた場所に合わせる）。

```sh
claude mcp add zigzagumap -- node C:\tools\zigzagumap-mcp.mjs
```

すべてのプロジェクトで使うときは `--scope user` を付けます。登録できたかは `claude mcp list` か、Claude Code の中の `/mcp` で確かめます。

Claude Desktop では、設定ファイル `claude_desktop_config.json`（設定 > 開発者 > 設定を編集）の `mcpServers` に足します。

```json
{
  "mcpServers": {
    "zigzagumap": {
      "command": "node",
      "args": ["C:\\tools\\zigzagumap-mcp.mjs"]
    }
  }
}
```

ZigzaguMap を `--profile <フォルダ>` で起動しているときは、MCP サーバーにも同じ `--profile <フォルダ>` を付けます（`mcp.json` をそのフォルダから読む）。

## 許可

既定では、AI が使えるのは読むだけの道具です。設定 > MCP の窓口 の次の項目で、許すことを足します。許可は道具を呼ぶたびに見るので、途中で変えるとすぐ反映されます。

| 項目 | 許すこと |
|---|---|
| AI にマップの書き換えを許す | ブロック・移動許可・ボーダー・イベントの項目の書き換え、元に戻す・やり直す |
| AI に出力を許す | プロジェクトフォルダの `maps\` への出力 |
| AI にスクリプトのファイルの書き換えを許す | 出力が `.s`・`eventscripts`・`.string` も書くとき（イベントのラベルの付け直しや、対応表で作る新しいファイルがあるとき）の出力 |

許していない道具を呼ぶと、どの項目をオンにすればよいかを書いた文が返ります。

## 道具の一覧

名前は、利用者のスクリプトの `zz` API の名前の `.` を `_` にしたものです（`map.setBlock` → `map_setBlock`）。`map_` で始まる道具は、開いているマップを読み書きします。先に `map_open` で開きます。座標はマスの単位で、左上が (0, 0) です。

読むだけ:

| 道具 | 内容 |
|---|---|
| `maps_list` | マップの一覧（バンク・マップ番号・名前） |
| `map_open` | マップを開く（画面にも出す） |
| `map_current` | 開いているマップ |
| `map_getBlock`・`map_getMovement` | 1 マスのブロック番号・移動許可 |
| `map_getCells` | 矩形（省略で全体）のブロック番号と移動許可 |
| `maps_getCells` | 開いていないマップの矩形 |
| `map_getBorder` | ボーダーの 1 マス |
| `map_getHeader`・`map_getTilesets` | ヘッダー、タイルセットのポインタ |
| `names_list` | マップ名・種族名の一覧 |
| `events_list`・`events_get` | イベントの一覧、1 つの全項目 |
| `map_image` | 矩形（省略で全体）を PNG で返す（ブロックだけ。1 マス 16 ピクセル） |
| `edit_status` | 未出力のマップ、元に戻せるか、許可 |

書き換え（「AI にマップの書き換えを許す」が要る。1 回の呼び出しが「元に戻す」1 回分）:

| 道具 | 内容 |
|---|---|
| `map_setBlock`・`map_setMovement` | 1 マスに置く |
| `map_setCells` | 矩形にブロック番号・移動許可の配列を書く |
| `map_setBorder` | ボーダーの 1 マス |
| `map_fill` | 塗りつぶし（`magic` でつながっていない同じマスも） |
| `map_shift` | 配置全体をずらす（はみ出た分は反対側へ） |
| `events_set`・`events_move` | イベントの項目を変える、動かす |
| `edit_undo`・`edit_redo` | AI が行った直前の書き換えを戻す・やり直す |

出力（「AI に出力を許す」が要る）: `project_export`（ファイル > 出力 と同じ。出力先はプロジェクトフォルダだけ）。

イベントを足す・消す道具はありません（足すと `.s` にひな形を書くため）。`zz` API のうち画面を操作するもの（`ui.*`・`view.setGrid`）も出しません。

## 安全のための作り

- 窓口は既定でオフです。オンにしたときだけ、127.0.0.1（この PC の中だけ）で待ち受けます。ほかの PC からは届きません。
- 合言葉は窓口を開くたびに作る乱数（16 バイト）です。合言葉の無い頼み、宛先の名前が 127.0.0.1・localhost でない頼み、ブラウザのページからの頼み（`Origin` が付いたもの）は断ります。
- 窓口が受けるのは道具の呼び出しだけです。自動操作の入口（`--automation`）の命令やメニューの操作は通りません。
- 道具はパスを受け取りません。ROM・`.s` を直接書く道具、外部のコマンドを動かす道具はありません。出力はファイル > 出力 と同じで、プロジェクトフォルダの中だけに書きます。
- 書き換えは操作の履歴に積むので、画面の Ctrl+Z で戻せます。`edit_undo` は AI が行った書き換えだけを戻し、利用者の操作は戻しません。
- 書き換えと出力をしたときは、ステータスバーに `MCP: 道具の名前` を出します。
- ZigzaguMap を 2 つ開いて両方で窓口を開くと、`mcp.json` は後から開いたほうになります。

## 開発

- 道具の定義（名前・説明・引数の型・許可の区切り）は `packages/core/src/mcp/tools.ts`、道具の中身は `McpToolRunner.ts`、JSON-RPC の受け答えは `McpServer.ts` にあります。道具の中身は `McpWorkspace` を通して読み書きし、開いている ZigzaguMap では `apps/desktop/src/app/mcp/AppMcpWorkspace.ts` がそれに当たります。
- MCP サーバーの本体は `tools/mcp/src/`（つなぐ処理は `bridge.ts`）。`pnpm --filter @zigzagumap/mcp build` で core といっしょに 1 つのファイルにまとめます。依存は Node の組み込みだけで、MCP の SDK は使っていません。
- ZigzaguMap の窓口は `apps/desktop/src-tauri/src/mcp_bridge.rs`（待ち受けと合言葉の確かめ）と `apps/desktop/src/app/mcp/`（設定と道具の実行）です。
- MCP の版は 2026-07-28（毎回の頼みに `_meta` で版を付ける形）と、それより前の `initialize` で始める形（2024-11-05〜2025-11-25）の両方に答えます。
- テスト: `packages/core/test/mcp.test.ts`（道具の定義と `zz` API の対応、引数の確かめ、読み書き・元に戻す・許可の無い操作の拒否、JSON-RPC）、`tools/mcp/test/bridge.test.ts`（つなぐ処理と stdio）、`tests/automation/mcp_bridge_check.py`（exe と MCP サーバーを動かして通しで確かめる）。
