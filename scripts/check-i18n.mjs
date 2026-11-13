// 画面の文言を、改訂版 Japanese.ini（apps/desktop/src/i18n/source/Japanese.ini）に補正 overrides.ini を重ねたものを基準に突き合わせる。
//
//   node scripts/check-i18n.mjs [--inventory <inventory のフォルダ>] [--old-ini <AdvanceMap 1.92 の Japanese.ini>] [--verbose]
//
// 調べること:
//   1. ini.generated.ts が Japanese.ini・overrides.ini と合っているか
//   2. ja*.ts が引いている番号が ini にあるか（注記を外して空になった番号も「無い」扱い）
//   3. ja*.ts に直接書いた文字列のうち、ini の値と同じもの（ini から引くべきもの）
//   4. 画面で使っている文言（ja*.ts が引いている番号と、節ごと使っている節の値）に残った
//      英語だけの値・文字化け・タブ文字（直すときは overrides.ini に書く。許す英語は ALLOWED_ENGLISH）
//   5. inventory の部品表と部品の一覧（AdvanceMap の画面の文字列）のうち、アプリに対応が無いもの
//      inventory の文字列は AdvanceMap 1.92 の表記なので、旧版の ini（--old-ini、cp932）で節と番号を求め、
//      改訂版の同じ番号をアプリが引いているか（または同じ文言を持っているか）で判断する。
// 見つかったものがあれば終了コード 1。意図した違いは INTENTIONAL に理由を付けて書く。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { displayValue, findNotes, generate, mergeIni, OUT_PATH, parseIni, readSources } from "./gen-i18n.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const I18N_DIR = join(ROOT, "apps/desktop/src/i18n");

/**
 * 旧版から番号や節が変わったもの（旧版の節/番号 → 改訂版の節/番号）。
 * inventory の文字列（旧版の表記）を改訂版の番号に読み替えるのに使う。
 */
const RENAMED = new Map([
  // 改訂版の [Toolbar] は並びが違うので、ボタンの役割で対応させる
  ["Toolbar/14", "Toolbar/15"],
  ["Toolbar/15", "Toolbar/17"],
  ["Toolbar/17", "Toolbar/19"],
  ["Toolbar/18", "Toolbar/20"],
  ["Toolbar/19", "Toolbar/18"],
  ["Toolbar/20", "Toolbar/14"],
  // 題名は Titel から Title へ
  ["PalettenForm/Titel", "PalettenForm/Title"],
  ["BlockDatenAnpassenForm/Titel", "BlockDatenAnpassenForm/Title"],
  ["WorldMapEditor/Titel", "WorldMapEditor/Title"],
  ["AnbindungsForm/136", "AnbindungsForm/Title"],
  ["NewMapForm/21", "NewMapForm/Title"],
  ["MapEinfuegenForm/15", "MapEinfuegenForm/Title"],
  // 種別名は [EventType] へ
  ["Events/40", "EventType/01"],
  ["Events/41", "EventType/00"],
  ["Events/42", "EventType/02"],
  ["Events/43", "EventType/03"],
  ["Events/44", "EventType/05"],
  ["Events/46", "EventType/04"],
  // コネクションの方向は [ConnectionDirections] へ
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => [`AnbindungsForm/1362${i}`, `ConnectionDirections/0${i}`]),
]);

/**
 * 意図した違い（キーは「節/番号」か、直接書いた文字列）。
 * - 節/番号: inventory にあるがアプリでは使わない部品・文言
 * - 文字列: ini の値と同じだが、ini から引かない理由があるもの
 */
const INTENTIONAL = new Map([
  // ROM へ書き込まないので読み替えたもの
  ["Menue/112", "ROMの保存は「出力」に読み替え"],
  ["Menue/113", "ROMに名前を付けて保存は「出力先を指定して出力」に読み替え"],
  ["Toolbar/11", "ROMの保存は「出力」に読み替え"],
  ["Allgemein/70", "変更を保存しますか？は「変更を出力しますか？」に読み替え"],
  ["BlockEditorForm/130102", "パレットの変更をROMに上書きするは「パレットの変更を反映する」に読み替え"],
  ["KontextMenu/10", "コンテキストメニューは「ZigzaguMapで開く」に読み替え"],
  ["KontextMenu/20", "コンテキストメニューの説明は登録しない（「ZigzaguMapで開く」だけ）"],
  ["EndnutzerForm/30", "AdvanceMap を ZigzaguMap に置き換えて使う"],
  // ROM の再配置・ダミーデータ（ZigzaguMap は ROM へ書かないので出さない）
  ["Header/9550", "マップスクリプトの再配置先（ROM へ書かない）"],
  ["Allgemein/50", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/51", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/54", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/56", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/57", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/58", "ダミーデータ（ROM へ書かないので不要）"],
  ["Allgemein/59", "ダミーデータ（ROM へ書かないので不要）"],
  ["HeaderVerschieben/13700", "ダミーデータ（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/11", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/12", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/13", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/14", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/15", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/20", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/21", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["MapBankHeaderForm/23", "マップバンクヘッダーの管理（ROM へ書かないので不要）"],
  ["UmpointenForm/10", "空き領域の検索（ROM へ書かないので不要）"],
  ["UmpointenForm/80", "空き領域の検索（ROM へ書かないので不要）"],
  ["UmpointenForm/82", "空き領域の検索（ROM へ書かないので不要）"],
  ["UmpointenForm/86", "空き領域の検索（ROM へ書かないので不要）"],
  ["Menue/1160", "バックアップの作成（ROM へ書かないので不要）"],
  ["Allgemein/71", "ROM の保存の失敗（出力の失敗は ZigzaguMap 独自の文言）"],
  ["Menue/149", "Read me で開くファイル名（ZigzaguMap は README を開く）"],
  // ワールドマップエディタのルーチン（ZigzaguMap は ROM のルーチンを書き換えない）
  ["WorldMapEditor/32", "ルーチンを書き換えないので出ない"],
  ["WorldMapEditor/62", "ルーチンを書き換えないので出ない"],
  ["WorldMapEditor/52", "ワールドマップ番号の割り当ては AdvanceMap でも押せない"],
  ["WorldMapEditor/53", "ワールドマップ番号の割り当ては AdvanceMap でも押せない"],
  ["WorldMapEditor/60", "AdvanceMap でも再現できなかった文言（ZigzaguMap は幅を表から読む）"],
  ["WorldMapEditor/42", "1.92 の画面には出ない（世界地図のボタンは 41）"],
  // AdvanceMap 1.92 でも出ない・見えないもの
  ["Header/9332", "AdvanceMap 1.92 でも出ない（大きすぎるマップは 9333）"],
  ["Events/438", "秘密基地の欄は FRLG では表示されない"],
  ["Events/439", "秘密基地の欄は FRLG では表示されない"],
  ["Allgemein/942", "ヘッダーを表示できないマップは無い（ZigzaguMap は常に場所の設定を出す）"],
  ["Allgemein/03", "警告のメッセージボックスは使う場面が無い"],
  // Windows や Delphi の部品の文言（ini を使わない）
  ["EndnutzerForm/10", "メッセージボックスのボタンは Windows 標準の「はい(Y)」"],
  ["EndnutzerForm/11", "メッセージボックスのボタンは Windows 標準の「いいえ(N)」"],
  ["INI-Version/SchriftArt", "フォントは CSS で指定する"],
  ["Cancel", "Delphi の入力ダイアログのボタン（ini の Cancel は別の画面のもの）"],
]);

/**
 * 画面で使っていてよい英語だけの値（値 → 理由）。旧版でも英語で、画面の用語として定着しているもの。
 * [INI-Version] と各節の Amount（件数）は文言ではないので調べない。
 */
const ALLOWED_ENGLISH = new Map([
  ["OK", "ボタン（旧版も OK）"],
  ["Read me", "ヘルプのメニュー（旧版も Read me）"],
  ["Tileset", "タイルセット番号で並べたときの一覧の見出し（AdvanceMap 1.92 も「Tileset 0」）"],
  ["BGM:", "場所の設定タブの見出し（BGM は日本語の用語として定着）"],
  ["No.:", "BGM の番号の欄（「ワープNo.:」などと同じ書き方）"],
  ["15bit to RGB", "パレットエディタのボタン（旧版も英語）"],
  ["Most recently used ROM", "最後に開いたROMのショートカットのファイル名（旧版も英語）"],
]);

/** 文字化けらしい値（cp932 と Latin-1 の取り違え「Pok駑on」「PokÃ©mon」と、置換文字）。 */
function looksGarbled(value) {
  return /[A-Za-z][^\x00-\x7F\u3000-\u30FF\uFF00-\uFFEF]+[A-Za-z]/.test(value) || /[\u00C2\u00C3][\u0080-\u00BF]/.test(value) || /\uFFFD/.test(value);
}

/** まだ作っていない機能の文言（作るときに ini から引く）。報告はするが問題には数えない。 */
const UNIMPLEMENTED = new Map([
  // 今は無い（例: ["NewMapForm", "新規マップの作成ダイアログ"]）
]);

function parseArgs(argv) {
  const args = { inventory: null, oldIni: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--inventory") args.inventory = argv[++i];
    else if (argv[i] === "--old-ini") args.oldIni = argv[++i];
    else if (argv[i] === "--verbose") args.verbose = true;
    else throw new Error(`知らない引数です: ${argv[i]}`);
  }
  return args;
}

/** 改訂版の ini に overrides.ini を重ねた値（画面に出す形）。節 → 番号 → 値。 */
function loadNewIni() {
  const { text, overrides } = readSources();
  const sections = new Map();
  const notes = new Map();
  for (const [name, entries] of mergeIni(text, overrides)) {
    const out = new Map();
    for (const [key, raw] of entries) {
      for (const note of findNotes(raw)) notes.set(note, (notes.get(note) ?? 0) + 1);
      const v = displayValue(raw);
      if (v !== null) out.set(key, v);
    }
    sections.set(name, out);
  }
  return { text, overrides, sections, notes };
}

/** 文字列リテラルとテンプレートの固定部分を取り出す（コメント行は除く）。 */
function literalsOf(line) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
  const code = line.replace(/\/\/.*$/, "");
  const out = []; // { text, whole }（whole: 置き換えの無い文字列全体）
  for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const parts = m[1] !== undefined ? [m[1]] : m[2].split(/\$\{[^}]*\}/);
    for (const p of parts) out.push({ text: p.replace(/\\\\/g, "\\"), whole: parts.length === 1 });
  }
  return out.filter((s) => s.text.trim() !== "");
}

/** ja*.ts を読み、ini の参照と直接書いた文字列を集める。 */
function scanApp() {
  const refs = []; // { section, key, where }
  const wholeSections = new Set();
  const literals = []; // { text, whole, where }
  for (const file of readdirSync(I18N_DIR).filter((f) => /^ja.*\.ts$/.test(f))) {
    const lines = readFileSync(join(I18N_DIR, file), "utf8").split("\n");
    const aliases = new Map(); // 別名 → 節
    lines.forEach((line, i) => {
      const where = `${file}:${i + 1}`;
      for (const m of line.matchAll(/const (\w+) = ini(?:\.(\w+)|\["([^"]+)"\]);/g)) aliases.set(m[1], m[2] ?? m[3]);
      // ini.節 / ini["節"] の後ろに番号が続く参照と、節ごと渡す参照
      for (const m of line.matchAll(/\bini(?:\.([\w]+)|\["([^"]+)"\])(?:\["([^"]+)"\]|\.(\w+))?/g)) {
        const section = m[1] ?? m[2];
        const key = m[3] ?? m[4];
        if (key !== undefined) refs.push({ section, key, where });
        else if (!/const \w+ = ini/.test(line)) wholeSections.add(section);
      }
      for (const [alias, section] of aliases) {
        for (const m of line.matchAll(new RegExp(`(?<![\\w.])${alias}(?:\\["([^"]+)"\\]|\\.(\\w+))`, "g"))) {
          refs.push({ section, key: m[1] ?? m[2], where });
        }
      }
      for (const { text, whole } of literalsOf(line)) literals.push({ text, whole, where });
    });
  }
  return { refs, wholeSections, literals };
}

/** md の表と「」から文字列を集める（inventory 用）。 */
function inventoryStrings(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (name !== "_drafts" && name !== "_ref") walk(p);
      } else if (/\.md$/.test(name) && (/^\d\d_/.test(name) || relative(dir, p).startsWith("_raw"))) {
        if (name !== "00_index.md") files.push(p);
      }
    }
  };
  walk(dir);
  const out = []; // { text, file }
  for (const file of files) {
    const rel = relative(dir, file).replace(/\\/g, "/");
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      for (const m of line.matchAll(/「([^」]+)」/g)) out.push({ text: m[1], file: rel });
      if (line.startsWith("|")) {
        for (const cell of line.split("|").slice(1, -1)) {
          const t = cell.trim();
          out.push({ text: t, file: rel });
          // 「00-無し／01-雲」のような並び
          if (t.includes("／")) for (const part of t.split("／")) out.push({ text: part.trim(), file: rel });
        }
      }
    }
  }
  return out.filter((s) => s.text !== "");
}

function main() {
  const args = parseArgs(process.argv);
  const problems = [];
  const report = (title, items) => {
    console.log(`\n## ${title}（${items.length} 件）`);
    for (const item of items) console.log(`- ${item}`);
    if (items.length > 0) problems.push(title);
  };

  const { text, overrides, sections, notes } = loadNewIni();
  console.log(`改訂版 Japanese.ini（overrides.ini を重ねたもの）: ${[...sections.values()].reduce((n, s) => n + s.size, 0)} 件（${sections.size} 節）`);
  console.log(`外した注記: ${[...notes].map(([n, c]) => `${n} ${c} 件`).join("、") || "なし"}`);

  // 1. 生成物
  let generated = "";
  try {
    generated = readFileSync(OUT_PATH, "utf8");
  } catch {
    // 無ければ違う
  }
  report("ini.generated.ts と Japanese.ini の食い違い", generated === generate(text, overrides) ? [] : ["node scripts/gen-i18n.mjs で作り直してください"]);

  // 2. 無い番号の参照
  const app = scanApp();
  const missing = app.refs.filter((r) => !sections.get(r.section)?.has(r.key)).map((r) => `${r.where} ${r.section}/${r.key}`);
  report("ini に無い番号の参照", missing);

  // アプリが持つ文言（引いている値と、直接書いた文字列）
  const referenced = new Set(app.refs.map((r) => `${r.section}/${r.key}`));
  const appValues = new Set(app.literals.map((l) => l.text.trim()));
  for (const r of app.refs) {
    const v = sections.get(r.section)?.get(r.key);
    if (v !== undefined) appValues.add(v.trim());
  }
  for (const s of app.wholeSections) for (const v of sections.get(s)?.values() ?? []) appValues.add(v.trim());

  // 3. ini の値と同じ文字列を直接書いているもの
  const newByValue = new Map();
  for (const [s, entries] of sections) {
    if (s === "INI-Version") continue;
    for (const [k, v] of entries) {
      const t = v.trim();
      if (!newByValue.has(t)) newByValue.set(t, []);
      newByValue.get(t).push(`${s}/${k}`);
    }
  }
  const hardcoded = app.literals
    .filter((l) => l.whole && newByValue.has(l.text.trim()) && !INTENTIONAL.has(l.text.trim()))
    .filter((l) => /[^\x00-\x40]/.test(l.text.trim()) && l.text.trim().length >= 2)
    .map((l) => `${l.where} 「${l.text.trim()}」 → ${newByValue.get(l.text.trim()).join(", ")}`);
  report("ini の値と同じなのに ini から引いていない文字列", hardcoded);

  // 4. 画面で使っている文言に残った英語・文字化け・タブ文字
  const shown = new Map(); // 節/番号 → 値
  for (const r of app.refs) {
    const v = sections.get(r.section)?.get(r.key);
    if (v !== undefined) shown.set(`${r.section}/${r.key}`, v);
  }
  for (const s of app.wholeSections) for (const [k, v] of sections.get(s) ?? []) if (k !== "Amount") shown.set(`${s}/${k}`, v);
  const leftovers = [];
  for (const [key, v] of [...shown].sort()) {
    if (key.startsWith("INI-Version/")) continue;
    const why = [];
    if (/^[\x00-\x7F]+$/.test(v) && /[A-Za-z]/.test(v) && !ALLOWED_ENGLISH.has(v.trim())) why.push("英語だけ");
    if (looksGarbled(v)) why.push("文字化け");
    if (v.includes("\t")) why.push("タブ文字");
    if (why.length > 0) leftovers.push(`${key} 「${v.replace(/\t/g, "\\t")}」（${why.join("・")}）`);
  }
  report("画面で使っている文言に残った英語・文字化け・タブ文字", leftovers);

  // 5. inventory との突き合わせ
  if (args.inventory) {
    if (!args.oldIni) throw new Error("--inventory には --old-ini（AdvanceMap 1.92 の Japanese.ini）も指定してください");
    const oldIni = parseIni(new TextDecoder("shift_jis").decode(readFileSync(args.oldIni)));
    const oldByValue = new Map();
    for (const [s, entries] of oldIni) {
      for (const [k, v] of entries) {
        const t = v.trim();
        if (t === "") continue;
        if (!oldByValue.has(t)) oldByValue.set(t, []);
        oldByValue.get(t).push(`${s}/${k}`);
      }
    }
    const covered = (oldKey, textValue) => {
      const key = RENAMED.get(oldKey) ?? oldKey;
      if (referenced.has(key) || INTENTIONAL.has(key)) return true;
      const [s, k] = key.split("/");
      if (app.wholeSections.has(s)) return true;
      const v = sections.get(s)?.get(k);
      return (v !== undefined && appValues.has(v.trim())) || appValues.has(textValue);
    };
    const seen = new Set();
    const uncovered = new Map(); // file → [項目]
    const unimplemented = [];
    let matched = 0;
    for (const { text: t, file } of inventoryStrings(args.inventory)) {
      const keys = oldByValue.get(t);
      if (!keys || seen.has(t)) continue;
      // 数字や 1 文字だけのもの（「00」「下」など）は部品の値と区別できないので、番号が 1 つに決まるときだけ見る
      if (!/[^\x00-\x40]/.test(t)) continue;
      seen.add(t);
      matched++;
      if (keys.some((k) => covered(k, t))) continue;
      const todo = keys.map((k) => UNIMPLEMENTED.get(k) ?? UNIMPLEMENTED.get(k.split("/")[0])).find(Boolean);
      if (todo) {
        unimplemented.push(`${todo}: 「${t}」 ${keys.join(", ")}`);
        continue;
      }
      if (!uncovered.has(file)) uncovered.set(file, []);
      uncovered.get(file).push(`「${t}」 ${keys.join(", ")}${keys.map((k) => sections.get(k.split("/")[0])?.get(k.split("/")[1])).filter(Boolean).map((v) => ` → 改訂版「${v}」`).join("")}`);
    }
    console.log(`\ninventory の文字列のうち旧版 ini にあるもの: ${matched} 件`);
    const items = [];
    for (const [file, list] of [...uncovered].sort()) for (const item of list) items.push(`${basename(file)}: ${item}`);
    report("AdvanceMap の部品の文字列で、アプリに対応が無いもの", items);
    console.log(`\n## まだ作っていない機能の文言（問題には数えない。${unimplemented.length} 件）`);
    for (const item of unimplemented) console.log(`- ${item}`);
  }

  if (args.verbose) {
    console.log("\n## 画面で使ってよい英語");
    for (const [v, why] of ALLOWED_ENGLISH) console.log(`- ${v}: ${why}`);
    console.log("\n## 意図した違い");
    for (const [k, why] of INTENTIONAL) console.log(`- ${k}: ${why}`);
    console.log("\n## 番号の読み替え（旧版 → 改訂版）");
    for (const [from, to] of RENAMED) console.log(`- ${from} → ${to}`);
  }
  console.log(problems.length === 0 ? "\n問題はありません。" : `\n問題: ${problems.join("、")}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main();
