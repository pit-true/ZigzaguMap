# ZigzaguMap

CFRU-JP 用のマップエディタです。AdvanceMap 風の操作で、ファイアレッド日本語版（BPRJ）のマップを編集し、`maps\` の JSON として書き出します。ベースROMには書き込みません。仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

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
pnpm tauri dev     # 開発用に起動
pnpm tauri build   # src-tauri/target/release/zigzagumap.exe を作る
```

## ライセンス

MIT（[LICENSE](LICENSE)）
