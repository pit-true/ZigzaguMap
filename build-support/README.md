# build-support（CFRU-JP のビルド側の変更）

ZigzaguMap が書くファイルを CFRU-JP のビルドで使うための、ビルド側の Python の変更です。ZigzaguMap は ROM を読むだけで、ROM へは書きません。ROM への反映は各プロジェクトのビルドが行います。

各プロジェクトのスクリプトを丸ごと置くのではなく、変更だけをパッチにしています。

| ファイル | 当てる先 | 中身 |
|---|---|---|
| `patches/string-multiline.patch` | `scripts/string.py`（ND と Chronos の `cfru` で同じファイル） | `.string` の 1 つの文字列を複数の行で書けるようにする |
| `patches/map_project-rom-erase-nd.patch` | ND の `scripts/map_project.py` | `maps/rom_erase.json` の範囲を 0xFF で埋める |
| `patches/map_project-rom-erase-chronos.patch` | Chronos の `cfru/scripts/map_project.py` | 同じ（Chronos の版に合わせたもの。改行は CRLF のまま） |
| `patches/map_project-trainers-nd.patch` | ND の `scripts/map_project.py`（rom-erase のパッチを当てたあと） | `maps/trainers.json` のトレーナーを ROM のトレーナーの表へ書く（#245） |
| `patches/map_project-trainers-chronos.patch` | Chronos の `cfru/scripts/map_project.py` | 同じ（改行は CRLF のまま） |
| `patches/map_project-pillow-nd.patch`、`patches/map_project-pillow-chronos.patch` | ND の `scripts/map_project.py`、Chronos の `cfru/scripts/map_project.py` | `maps/tilesets/*/tiles.png` を読むときに、`scripts/string.py` が標準の `string` の代わりに読み込まれて Pillow の読み込みが失敗するのを避ける（#314・#317。改行は CRLF のまま） |
| `patches/map_project-regionmap-nd.patch`、`patches/map_project-regionmap-chronos.patch` | ND の `scripts/map_project.py`、Chronos の `cfru/scripts/map_project.py`（trainers のパッチのあと） | `maps/regionmap.json` のタウンマップの表を ROM の表へ上書きする（#119。Chronos の版は改行が CRLF のまま） |
| `patches/map_project-visitflags-chronos.patch` | Chronos の `cfru`（`hooks`・`repoints`・`src/town_map_flags.c`・`scripts/map_project.py`。regionmap のパッチのあと） | タウンマップの訪問フラグ（人ID）を表引きにするフックと、`maps/regionmap.json` の `MapVisitFlags`・`DungeonVisitFlags` の取り込み（#499。Chronos だけ。改行は CRLF のまま） |
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

## maps/trainers.json（トレーナーの表に書く。#245）

ZigzaguMap で足した・変えたトレーナーです。形は ZigzaguMap の README の「maps\trainers.json の形式」にあります（Bochi の maps\ の JSON と同じ整形）。ND と Chronos には入れてあります。

- ファイルが無いか `Trainers` が空なら何もしません。このときの ROM は、パッチを当てる前とバイト単位で同じです。
- 書く時点は `_place_day_wild` のあと（マップのデータを置いたあと、`rom_erase.json` の確かめの前）です。`maps/project.json` が無くても、`trainers.json` があれば書きます（そのときは `allocation_start` から空き領域を使い、使い終わりを返します）。
- 表は `*(0x0800F5C0)`（CFRU の `gTrainers`）です。`Id` の行（`表 + Id × 0x20`）の 0x20 バイトを書きます: 手持ちの形式、クラス、BGM と性別、絵、名前（`charmap.tbl` で変える。5 バイト + 0xFF で埋める）、持ち物 4 つ、ダブルバトル、AI、手持ちの数、手持ちへのポインタ。手持ちは空き領域に置きます（1 匹 8 バイト、技ありの形式は 16 バイト）。
- `Id` が 743 以上なら、表（743 件）と足りない分の行（0 番の行の写し）を空き領域へ写し、ROM の先頭から元の表の前までの 4 バイト境界の語のうち、元の表の先頭の 1 件（0x20 バイト）の中を指すものを、新しい表の同じ位置へ付け替えます（素の FR の JP 版で 24 か所。`0xF5C0` のポインタ、`gTrainers`・`gTrainers + 4`・`gTrainers + 0xA` のリテラル）。表より後ろの、たまたま同じ値に見えるデータは触りません。付け替えた数をビルドのログに出します。
- 次のときはビルドを止めます（`ValueError`）: 形が違う（`Format` が 1 でない、`Trainers` が配列でない）、`Id` が 1〜767 でないか重なる、`Party` が 1〜6 匹でない、名前が `charmap.tbl` で変えられないか 5 バイトを超える。
- 768 から先の番号は使えません。戦ったかどうかのフラグ（`0x500 + 番号`）が、0x800 からのシステムのフラグと重なるためです。

## maps/regionmap.json（タウンマップの表に書く。#119）

ワールドマップエディターで変えたタウンマップの表です。形は docs/guide.md の「maps\regionmap.json」にあります。ND と Chronos には入れてあります（2026-11-17）。

- ファイルが無ければ何もしません。このときの ROM は、パッチを当てる前とバイト単位で同じです。
- 書くのはファイルにある表だけです。どの表も大きさが変わらないので、ROM の表をその場で上書きします。ポインタは書き換えません。
- 表の位置は、コードの中のポインタから読みます。CFRU が表を別の場所へ移していれば、移した先に書きます（ND と Chronos の `repoints`・`bytereplacement`・`hooks`・`src` には、今はこの表を動かすものも書くものもありません。ビルドした ROM でも、ポインタと表の中身はベース ROM のままでした）。
- 書く時点は `trainers.json` のあと（マップのデータを置いたあと、`rom_erase.json` の確かめの前）です。`maps/project.json` が無くても、`regionmap.json` があれば書きます。書いた表の名前をビルドのログに出します（`Wrote the town map tables from maps/regionmap.json: ...`）。

| キー | 書く先（ポインタの位置。BPRJ の素の ROM での表の位置） | 書き方 |
|---|---|---|
| `Layouts` | `0xC5378`・`0xC5380`・`0xC5388`・`0xC53B0`（GetMapNo。カントー・1〜3のしま・4〜5のしま・6〜7のしまの順。0x3B9018・0x3B92AC・0x3B9540・0x3B97D4） | 書かれた面の、`Layer` が `map` なら先頭の 330 バイト、`dungeon` なら後ろの 330 バイトに、`Rows` の 15 行 × 22 個の 16 進を並べて書く |
| `Positions` | `0xC4F20`（SetMapNo_and_Pos。0x3B89E8） | 地名 0x58〜0xC5 の 110 件を s16 の X・Y で書く |
| `Sizes` | `0xC4F1C`（0x3B8D00） | 110 件を u16 の幅・高さで書く |
| `FlyDestinations` | `0xC648C`（FlyDestination。0x3B9A68） | 地名 0x58〜0xC3 の 108 件を、バンク・マップ・飛び先の番号の 3 バイトで書く |
| `HealLocations` | `0xC0E74`・`0xC0E94`（GetWarpPosByMapID・GetWarpPosByNo。値は表の 8 バイト手前）と `0xC0E44`（表の先頭）。0x3B5944 | 20 件を、バンク・マップ（u8）、X・Y（s16）、`Unknown`（u16）で書く。`Unknown` の無い古いファイルは、末尾の 2 バイトを ROM のまま残す |
| `MapVisitFlags`・`DungeonVisitFlags` | ND: 書かない。Chronos: `0xC47C8`・`0xC4A64`（フックの直後に置いた表へのポインタ） | 訪問フラグ（人ID）は、素の ROM では表ではなく GetMapState・GetCaveState の switch 文。Chronos は表引きに置き換えたので、110 件の u16（null は 0xFFFF）で書く（下の「訪問フラグ（Chronos だけ。#499）」）。ND はキーがあれば「注意: maps/regionmap.json の MapVisitFlags は未対応のキーです。訪問フラグ（人ID）は ROM へ取り込みません（ZigzaguMap #499）」をログに出し、ほかの表は書いてビルドを続ける |

次のときはビルドを止めます（`ValueError`。どのキーの何番目のどの値が悪いかを日本語で出す）。

- JSON として読めない（行と文字の位置を出す）、`Format` が 1 でない、知らないキーがある。
- 件数が違う（`Positions`・`Sizes` は 110 件、`FlyDestinations` は 108 件、`HealLocations` は 20 件）、`Id`（`"0x58"` から順）や `Index`（1 から順）が違う。
- 値が範囲の外（X・Y は -32768 から 32767、幅・高さと `Unknown` は 0 から 65535、バンク・マップ・飛び先の番号は 0 から 255）。整数でない値も止める。
- `Layouts` の `Page`・`Layer` が違う、同じ面とレイヤーが 2 回ある、`Rows` が 15 行でない、行が 16 進 2 桁 22 個でない。
- 表を指すポインタが ROM の外を指す。`HealLocations` の 3 つのポインタが同じ表を指していない。
- 書く範囲が、このフォルダのパッチの一覧（`bytereplacement` など。`rom_erase.json` と同じ調べ方）が書く位置と重なる。`rom_erase.json` で埋めた範囲に書いたときも、今までどおり止まる。

地名の名前は `regionmap.json` には無く、今までどおりマップの JSON のマップ名で書かれます。

### 訪問フラグ（Chronos だけ。#499）

ユーザーの返事（2026-11-17）で、Chronos だけ対応し、ND は対応しないことになりました。

- 素の ROM の GetMapState（0x080C47C0）・GetCaveState（0x080C4A5C）は、地名番号ごとの switch 文です。フラグを見る case は GetMapState が 20、GetCaveState が 31。戻す値は 0 = SPACE（0xC5）、1 = ROAD（フラグの無い場所）、2 = ARRIVE（フラグが立っている）、3 = NOARRIVE（立っていない）。フラグのほかの条件を見ているのは、GetMapState の 0x63（4ばんどうろのポケモンセンター。空を飛ぶが使えない間は SPACE）だけです。
- Chronos は `cfru/src/town_map_flags.c` で 2 つの関数を置き換えます（`hooks` で関数の先頭、r1）。表は u16 × 110（地名 0x58〜0xC5、フラグ無しは 0xFFFF）が 2 つで、初めの中身は素の ROM の switch 文と同じフラグです。`repoints` でフックの直後（0x080C47C8・0x080C4A64）に表へのポインタを置き、関数・`map_project.py`・ZigzaguMap は、このポインタから表を読み書きします。
- 0x63 の条件は C の側に残しました。0x63 のフラグを変えても条件はそのままで、フラグだけが替わります。null にすると ROAD です。
- `map_project.py` は、キーがあれば表を書きます。件数・`Id` の違い、`Flag` が `"0x0890"` の形でも null でもない、0x0001〜0x08FF の外、0xC5 にフラグがある、フックが無い（`0x080C47C0` が `ldr r1, [pc, #0]; bx r1` でない）ときは、ビルドを止めます。
- Chronos の `tools/check_town_map_flags.py` は、ビルドした ROM の 2 つの関数を小さな Thumb の実行器で、地名番号 0x00〜0xFF のすべてについて、フラグと GetRegionMapPermission の結果の 4 通りで動かし、素の ROM（`--json` があれば人ID を JSON の値に替えたもの）と、戻す値・聞いたフラグが同じかを比べます。
- ZigzaguMap は、関数の先頭がフックなら直後のポインタから表を読み、そうでなければ今までどおり switch 文から読みます。ワールドマップエディターは、開いているプロジェクトの `hooks` にこの 2 つのフックが無ければ、人ID の欄の下に「人ID: このプロジェクトでは、ゲームに反映されません」と出します（ROM だけを開いたときは欄の説明だけ）。
- ゲームの中（エミュレータ）では確かめていません。確かめる手順は Chronos の docs/MAP_PROJECT.md の「タウンマップの訪問フラグ」にあります。

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

trainers.json（#245）のパッチは、rom-erase のパッチを当てたあとの `map_project.py` に当てます（ND は rom-erase のパッチを先に当てる）。

```sh
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-trainers-nd.patch        # ND
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-trainers-chronos.patch   # Chronos の cfru
```

regionmap.json（#119）のパッチは、trainers のパッチを当てたあとの `map_project.py` に当てます。

```sh
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-regionmap-nd.patch        # ND
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-regionmap-chronos.patch   # Chronos の cfru
```

訪問フラグ（#499）のパッチは Chronos だけで、regionmap のパッチのあとに `cfru` で当てます（`src/town_map_flags.c` を足し、`hooks`・`repoints`・`scripts/map_project.py` を直す）。

```sh
git -c core.autocrlf=false apply <ZigzaguMap>/build-support/patches/map_project-visitflags-chronos.patch   # Chronos の cfru
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

## 確かめたこと（regionmap.json。2026-11-17）

ND と Chronos のフォルダの写しで行いました。

- `regionmap.json` が無いとき、変更の前と後でビルドした ROM がバイト単位で同じ（Chronos は `build/Chronos.gba` をビルドし直して、ND は CFRU の全体のビルドと `scripts/insert.py` だけの作り直しの両方で比べた）。
- ワールドマップエディターでマサラタウンの座標・幅/高さ・空を飛ぶの行き先・飛び先、人ID、カントーの基本レイヤーと 1〜3のしまのトップレイヤーのマスを変えて出力し（`python tests/realcopy/run.py --regionmap`）、ビルドすると、ROM の表が JSON のとおりになり、ファイルが無いときの ROM との違いは表の中の 8 バイトだけ。ポインタと人ID の switch 文は変わらない。できた ROM だけを開き直すと、ワールドマップエディターに同じ値が出る（人ID は元のまま）。ND は DPE まで通し、DPE の `test.gba` でも表が同じ。
- 人ID があると、ND はビルドのログに「未対応のキー」の注意が出て、ビルドは続く。
- 壊れた JSON、範囲外の値、16 進でない `Rows`、知らないキーで、`scripts/insert.py` が止まる（ND の写し）。ポインタの不一致、表を移した ROM、`bytereplacement` との重なりは `tests/check_cfru_tree.py` で確かめている。

## maps/tilesets の tiles.png と Pillow（map_project-pillow）

`maps/tilesets/<フォルダ>/tileset.json` があると（ブロックエディタで変えたタイルセット、別の ROM から取り込んだタイルセット）、`map_project.py` は `tiles.png` を Pillow で読みます。`scripts/insert.py` から動くときは `scripts/` が `sys.path` の先頭にあるため、Pillow の中の `import logging` → `from string import Template` が `scripts/string.py` を読んでしまい、「Pillow is required to build edited map tilesets」で止まります（Pillow を入れていても止まる）。

パッチは、Pillow を読む間だけ `scripts/` を `sys.path` から外し、読み込み済みの `scripts/string.py` を `sys.modules` から一時的に外します。読んだ後は元に戻すので、ほかの処理は変わりません。`maps/tilesets` が無い間は Pillow を読まないので、ビルドの ROM はパッチを当てる前と同じです。
