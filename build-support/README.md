# build-support（CFRU-JP のビルド側の変更）

ZigzaguMap が書くファイルを CFRU-JP のビルドで使うための、ビルド側の Python の変更です。ZigzaguMap は ROM を読むだけで、ROM へは書きません。ROM への反映は各プロジェクトのビルドが行います。

各プロジェクトのスクリプトを丸ごと置くのではなく、変更だけをパッチにしています。

| ファイル | 当てる先 | 中身 |
|---|---|---|
| `patches/string-multiline.patch` | `scripts/string.py`（ND と Chronos の `cfru` で同じファイル） | `.string` の 1 つの文字列を複数の行で書けるようにする |
| `patches/map_project-rom-erase-nd.patch` | ND の `scripts/map_project.py` | `maps/rom_erase.json` の範囲を 0xFF で埋める |
| `patches/map_project-rom-erase-chronos.patch` | Chronos の `cfru/scripts/map_project.py` | 同じ（Chronos の版に合わせたもの。改行は CRLF のまま） |
| `tests/check_cfru_tree.py` | | パッチを当てたフォルダを確かめる（読むだけ。一時フォルダで動かす） |

Chronos の幅検査（`tools/check_text_width.py`）にも同じ複数行の規則を入れています。これは Chronos だけの道具なので、Chronos のリポジトリに直接入れました（パッチは置いていません）。

## 複数行の文字列（.string）

本文の行が `\n`・`\p`・`\l`・`\m`（改行・改ページ。charmap の FE・FB・FA）でちょうど終わり、次の行も本文の行なら、次の行を同じ文字列の続きとしてつなぎます。

```
#org @gText_Moegi_Npc3
こんにちは！\n
きょうは いいてんきだね\p
またね
```

は、1 行で書いた `こんにちは！\nきょうは いいてんきだね\pまたね` と同じバイト列になります。

- つなぐときは何も足さず、何も削りません。続きの行の頭の空白も、そのまま文字として入ります。
- 制御記号の後ろに空白などがあれば、そこで文字列が終わります（今までと同じ）。`\\n` のように前のバックスラッシュで打ち消された形も続きにしません。
- 続きにならない行: 空行、`//` のコメント、`#org`、`#include`・`#ifdef` などの指定と、条件で飛ばす行。これらが来ると、その前で文字列が終わります。
- それ以外の行の終わりは、今までどおり文字列の終わりです（次の行はラベルの無い別の文字列）。
- `MAX_LENGTH` と `FILL_FF` は、つないだあとの 1 つの文字列に当てます（1 行で書いたときと同じ）。
- 誤り（`Error parsing string on line N ...` など）の行番号は、その字がある実際の行です。
- 既存のファイルの意味は変わりません。ND（`NeoDark-CFRU` 26 ファイル、`NeoDark-DPE` 2 ファイル）と Chronos（`cfru` 45 ファイル、`dpe` 2 ファイル）を調べ、制御記号で終わる行の次は、どれも空行かファイルの終わりでした（2026-11-14）。
- Chronos の `charmap.tbl` には `\m` がありません（ND にはある）。Chronos で `\m` を書くと、行の終わりでも途中でも、今までどおり変換の誤りになります。

## maps/rom_erase.json（素の ROM の範囲を 0xFF で埋める）

ZigzaguMap でイベントを消したとき、そのスクリプトが素の ROM にあれば、0xFF で埋める範囲をここに書きます。形は Bochi の maps\ の JSON と同じ整形（2 空白の字下げ、CRLF、ASCII 以外は `\uXXXX`）です。

```json
{
  "Format": 1,
  "Ranges": [
    { "Address": "0x0816A2B4", "Length": 37, "Type": "script", "Bank": 3, "Map": 0, "Event": "person", "Index": 2 }
  ]
}
```

- ビルドが使うのは `Address`（GBA のアドレス。`0x08000000` 以上の 16 進の文字列）と `Length`（1 以上のバイト数）だけです。ほかの項目は記録用で、知らない項目は読み飛ばします。
- ファイルが無ければ何もしません。このときの ROM は、パッチを当てる前とバイト単位で同じです。
- 埋めるのは、`scripts/insert.py` が `apply_project` を呼んだ時点（`output.bin`・`bytereplacement`・special inserts・`hooks`・`repoints`・`generatedrepoints` / `repointall`・`routinepointers`・`functionrewrites` のあと、`eventscripts` の前）で、マップのデータを置く前です。`maps/project.json` が無くても、`rom_erase.json` があれば埋めます。
- 次のときはビルドを止めます（`ValueError`）。
  - 形が違う（`Format` が 1 でない、`Address` が文字列でない、`Length` が 1 未満など）。
  - 範囲がベース ROM の部分（`0x08000000`〜`0x08FFFFFF`）の外にかかる。`0x09000000` から先は CFRU のコード（`OFFSET_TO_PUT`）と DPE の領域なので埋めません。
  - 範囲が、このフォルダのパッチの一覧が決まった位置に書くところと重なる。調べるのは `bytereplacement`（書くバイト数）、`hooks`（8 か 10 バイト）、`repoints`・`routinepointers`（4 バイト）、`functionrewrites`（書く長さを insert.py と同じ式で求める）、`generatedrepoints`（`repointall` が書き換えた位置。4 バイト）、`special_inserts.asm` の `.org`（次の `.org` まで）。`#include` と `#ifdef` は insert.py と同じ規則で読み、無効な行は重なりに数えません。
  - マップのデータ（その場で書き換えるタイルセットのヘッダ、マップ名の表、マップバンクの表など）が、埋めた範囲に書かれた。
- `eventscripts` は `apply_project` のあとで人・看板などの表にポインタを書きます。ZigzaguMap は表そのものを埋める範囲に入れないので、ここは調べていません。

### 置き換えたマップの古い構造体

`map_project.py` は JSON のマップを空き領域に丸ごと置き直し、マップバンクの表の欄を新しいヘッダへ向けます。ベース ROM にある古いヘッダ・レイアウト・イベント表・接続などは、0xFF にせずそのまま残ります（どこからも指されなくなるだけ）。

これを埋めることは、ビルド側を変えずにできます。ZigzaguMap が古い構造体の範囲を `rom_erase.json` に `Type: "data"` で書けば、上の仕組みで埋まります。ただし FR では、同じレイアウトを複数のマップのヘッダが指すことがあり、ほかのコードや表が古い場所を指していることもあります。埋めるなら、スクリプトと同じく ROM 全体のポインタを調べ、消すマップ以外から指されている範囲を外す必要があります。今は入れていません。

## 当て方

どちらも、プロジェクトのフォルダ（CFRU-JP のフォルダ）で `git apply` します。`core.autocrlf` が true だと、当てたファイルの改行が CRLF に変わるので、`-c core.autocrlf=false` を付けます（ND の `.py` は LF、Chronos の `map_project.py` は CRLF のまま残ります）。当てる前に `--check` で確かめてください。

ND（`NeoDark-CFRU-main` で）:

```sh
git -c core.autocrlf=false apply --check <ZigzaguMap>/build-support/patches/string-multiline.patch
git -c core.autocrlf=false apply --check <ZigzaguMap>/build-support/patches/map_project-rom-erase-nd.patch
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/string-multiline.patch
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-rom-erase-nd.patch
```

Chronos（`Chronos\cfru` で。Chronos には入れてあります）:

```sh
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/string-multiline.patch
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-rom-erase-chronos.patch
```

ND の差分ビルドは、`.string` より新しい `.o` を作り直しません。パッチを当てたあと、すでに複数行で書いた `.string` があるなら、その `.string` を保存し直すか `build` を消してからビルドしてください（Chronos のビルドは `scripts/string.py` の中身もキャッシュの鍵に入れているので、自動で作り直します）。

当てたあとは次で確かめます（フォルダは読むだけです）。

```sh
python build-support/tests/check_cfru_tree.py --cfru <CFRU-JP のフォルダ>
```

## 確かめたこと（2026-11-14）

ND と Chronos のフォルダの写しで行いました（実フォルダでは試していません）。

- パッチを当てる前と後で、今の内容からビルドした ROM がバイト単位で同じ（Chronos は `build/Chronos.gba`。ND は CFRU の `test.gba` で、ND の全体のビルドは画像の `.o` が毎回違うバイトになるため、ビルド済みのフォルダで `.string` だけを作り直して比べた）。Chronos の `python tools/check_text_width.py --source` の出力も同じ。
- すべての `.string` の本文を `\n`・`\p`・`\l`・`\m` のあとで改行した形に書き換えてビルドすると（ND 16 ファイル 1899 行、Chronos 34 ファイル 2183 行）、ROM 全体が 1 行のときと同じ。Chronos の幅検査の出力も同じ。パッチ無しの string.py と幅検査では、同じ書き換えで ROM が変わる・検査が止まる。
- `rom_erase.json` を置いてビルドすると、その範囲だけが 0xFF になり、ほかのバイトは変わらない（Chronos は `maps/project.json` が無い形、ND はある形で確かめた）。ベース ROM の外、`bytereplacement`、`special_inserts.asm` との重なりではビルドが止まる。`hooks`・`repoints`・`routinepointers`・`functionrewrites`・`generatedrepoints` との重なりと `#ifdef` の扱いは `tests/check_cfru_tree.py` で確かめている。
- 置いたマップのデータが埋めた範囲に書かれたときに止める検査は、実際のマップでは起きる場面を作っていない（確かめていない）。
