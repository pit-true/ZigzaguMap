import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeProjectFs } from "../src/node/index.js";
import { buildScriptIndex, ScriptCommandTable, ScriptIndex, ScriptWalker, walkScript, type WalkEvent } from "../src/index.js";

/** テスト用の小さな xse_commands.s（ND と同じ書き方の抜き出し）。 */
const XSE = `
.macro end
.byte 0x02
.endm
.macro return
.byte 0x03
.endm
.macro call destination:req
.byte 0x04
.word \\destination
.endm
.macro goto destination:req
.byte 0x05
.word \\destination
.endm
.macro if condition:req goto_or_call:req script:req
.byte \\goto_or_call, \\condition
.word \\script
.endm
.macro cond condition:req, goto_or_call:req, script:req
	if \\condition, \\goto_or_call, \\script
.endm
.macro goto_if condition:req, destination:req
.byte 0x06
.byte \\condition
.4byte \\destination
.endm
.macro cmpvar var:req, value:req
.byte 0x21
.2byte \\var
.2byte \\value
.endm
.macro compare var:req, value:req
	cmpvar \\var, \\value
.endm
.macro copyvar a:req, b:req
.byte 0x19
.2byte \\a
.2byte \\b
.endm
.macro switch var:req
	copyvar 0x8000, \\var
.endm
.macro case condition:req, dest:req
	compare 0x8000, \\condition
	if equal _goto \\dest
.endm
.macro loadpointer bank:req, pointer:req
.byte 0x0f
.byte \\bank
.word \\pointer
.endm
.macro callstd type:req
.byte 0x09
.byte \\type
.endm
.macro msgbox pointer:req type:req
	loadpointer 0x0 \\pointer
	callstd \\type
.endm
.macro applymovement index:req, movements:req, mapGroup, mapNum
	.ifb \\mapGroup
		.byte 0x4f
		.2byte \\index
		.4byte \\movements
	.else
		.byte 0x50
		.2byte \\index
		.4byte \\movements
		.byte \\mapGroup
		.byte \\mapNum
	.endif
.endm
.macro waitmovement index:req
.byte 0x51
.2byte \\index
.endm
.macro moveobject index:req, x:req, y:req
.byte 0x57
.2byte \\index
.2byte \\x
.2byte \\y
.endm
.macro changeface localId:req, direction:req
.byte 0x5b
.2byte \\localId
.byte \\direction
.endm
.macro setobjectxy index:req, x:req, y:req
	movesprite \\index, \\x, \\y
.endm
.macro turnobject localId:req, direction:req
	spriteface \\localId, \\direction
.endm
.macro lockfaceplayer
.byte 0x6a
.byte 0x5a
.endm
.macro lock
.byte 0x6a
.endm
.macro faceplayer
.byte 0x5a
.endm
.macro setescape map:req warp:req x:req y:req
.byte 0xc4
map \\map
.byte \\warp
.endm
.equ _goto, 6
.equ _call, 7
.equ equal, 1
.equ PLAYER, 0xFF
`;

function project(files: Record<string, string>) {
  const index = new ScriptIndex();
  for (const [p, t] of Object.entries(files)) index.updateFile(p, t);
  const commands = ScriptCommandTable.build({ xseCommands: XSE });
  return new ScriptWalker({ index, commands, text: (p) => files[p] ?? null });
}

const ops = (events: readonly WalkEvent[]) =>
  events.map((e) => (e.type === "command" ? `${e.command.opcode.toString(16)}:${e.command.line}` : e.type === "stop" ? `stop:${e.reason}` : `warn:${e.kind}`));

describe("スクリプトを実行順にたどる（#450）", () => {
  it("call と return、行の何番目か、深さ", () => {
    const w = project({
      "a.s": "Main:\n\tlock\n\tcall Sub\n\tfaceplayer\n\tend\nSub:\n\tmsgbox Text 6\n\treturn\n",
    });
    const ev = walkScript(w, "Main");
    expect(ops(ev)).toEqual(["6a:1", "4:2", "f:6", "9:6", "3:7", "5a:3", "2:4", "stop:end"]);
    const msg = ev.filter((e) => e.type === "command").map((e) => e.command)[2]!;
    expect(msg).toMatchObject({ written: "msgbox", macro: "loadpointer", part: 0, depth: 1 });
    expect(msg.args.map((a) => a.text)).toEqual(["0x0", "Text"]);
  });

  it("goto_if の両方の答え、分岐の印と回数", () => {
    const files = { "a.s": "Main:\n\tcompare 0x4001 2\n\tgoto_if 1 Yes\n\tend\nYes:\n\treturn\n" };
    const no = walkScript(project(files), "Main", () => false);
    expect(ops(no)).toEqual(["21:1", "6:2", "2:3", "stop:end"]);
    const yes = walkScript(project(files), "Main", () => true);
    expect(ops(yes)).toEqual(["21:1", "6:2", "3:5", "stop:return"]);
    const b = yes.find((e) => e.type === "command" && e.command.branch)!;
    expect(b.type === "command" && b.command.branch).toEqual({ key: "a.s:2:0", visit: 1, taken: true, target: "Yes" });
  });

  it("case（compare と if の 2 命令）、cond、if", () => {
    const files = {
      "a.s": "Main:\n\tswitch 0x800D\n\tcase 1, One\n\tcond equal _call One\n\tif 1 _goto One\n\tend\nOne:\n\treturn\n",
    };
    const ev = walkScript(project(files), "Main");
    expect(ops(ev)).toEqual(["19:1", "21:2", "6:2", "7:3", "6:4", "2:5", "stop:end"]);
    const cmds = ev.filter((e) => e.type === "command").map((e) => e.command);
    expect(cmds[1]!.args.map((a) => a.value)).toEqual([0x8000, 1]);
    expect(cmds[2]!.part).toBe(1);
    // cond _call で呼ぶと戻ってくる
    const called = walkScript(project(files), "Main", (c) => c.opcode === 7);
    expect(ops(called)).toEqual(["19:1", "21:2", "6:2", "7:3", "3:7", "6:4", "2:5", "stop:end"]);
  });

  it("ファイルをまたぐ goto、ループの打ち切り", () => {
    const w = project({ "a.s": "Main:\n\tgoto Other\n", "b.s": "Other:\n\tlock\n\tgoto Other\n" });
    w.start("Main");
    const out: WalkEvent[] = [];
    for (let i = 0; i < 30_000; i++) {
      const e = w.next(() => false);
      out.push(e);
      if (e.type === "stop") break;
    }
    expect(ops(out.slice(0, 4))).toEqual(["5:1", "6a:1", "5:2", "6a:1"]);
    expect(out[out.length - 1]).toMatchObject({ type: "stop", reason: "limit" });
    expect(out.length).toBe(10_001);
  });

  it("データに入ったとき、ファイルの終わり、ラベルが無いとき、ROM のアドレス", () => {
    expect(ops(walkScript(project({ "a.s": "Main:\n\tlock\nm: .byte 0x10, 0xfe\n" }), "Main"))).toEqual(["6a:1", "stop:data"]);
    expect(ops(walkScript(project({ "a.s": "Main:\n\tlock\n" }), "Main"))).toEqual(["6a:1", "stop:eof"]);
    expect(ops(walkScript(project({ "a.s": "Main:\n\tgoto Nowhere\n" }), "Main"))).toEqual(["5:1", "stop:missingLabel"]);
    expect(ops(walkScript(project({ "a.s": "Main:\n\tgoto 0x8192F0E\n" }), "Main"))).toEqual(["5:1", "stop:romPointer"]);
    expect(ops(walkScript(project({ "a.s": "Main:\n\tcall 0x8192F0E\n\tend\n" }), "Main"))).toEqual(["4:1", "warn:callSkipped", "2:2", "stop:end"]);
    expect(ops(walkScript(project({}), "Main"))).toEqual(["stop:missingLabel"]);
  });

  it("定義の無い別名（setobjectxy・turnobject）は moveobject・changeface として読む。壊れたマクロは注意だけ", () => {
    const ev = walkScript(
      project({ "a.s": "Main:\n\tsetobjectxy 1 5 6\n\tturnobject PLAYER 2\n\tsetescape 1 2 3 4\n\tnosuchmacro\n\tlockfaceplayer\n\tend\n" }),
      "Main",
    );
    expect(ops(ev)).toEqual(["57:1", "5b:2", "warn:brokenMacro", "warn:unknownMacro", "6a:5", "5a:5", "2:6", "stop:end"]);
    const cmds = ev.filter((e) => e.type === "command").map((e) => e.command);
    expect(cmds[0]!.args.map((a) => a.value)).toEqual([1, 5, 6]);
    expect(cmds[1]!.args.map((a) => a.value)).toEqual([0xff, 2]);
  });

  it(".if 0 の中は読まない。同じ入力からは同じ並び", () => {
    const files = { "a.s": "Main:\n.if 0\n\tlock\n.else\n\tfaceplayer\n.endif\n\tapplymovement PLAYER m\n\tend\n" };
    const a = walkScript(project(files), "Main");
    expect(ops(a)).toEqual(["5a:4", "4f:6", "2:7", "stop:end"]);
    const inside = { "a.s": "Main:\n\tend\n.if 0\nDead:\n\tlock\n.endif\n" };
    expect(ops(walkScript(project(inside), "Dead"))).toEqual(["stop:inactive"]);
    expect(ops(walkScript(project(files), "Main"))).toEqual(ops(a));
  });
});

/** 実フォルダ（読むだけ）。 */
const projects = [
  { name: "ND", dir: process.env.ZIGZAGU_ND_DIR },
  { name: "Chronos", dir: process.env.ZIGZAGU_CHRONOS_DIR },
];

for (const { name, dir } of projects) {
  describe.skipIf(!dir || !existsSync(join(dir, "xse_commands.s")))(`実フォルダのスクリプトをたどる（${name}）`, () => {
    it("applymovement を含むラベルを全部、止まるまでたどれる", async () => {
      const read = (p: string) => readFileSync(join(dir!, p), "utf8");
      const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir!, n))).map(read);
      const commands = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
      const index = await buildScriptIndex(new NodeProjectFs(dir!));
      const texts = new Map<string, string | null>();
      const text = (p: string) => {
        if (!texts.has(p)) texts.set(p, existsSync(join(dir!, p)) ? read(p) : null);
        return texts.get(p)!;
      };
      const folder = "assembly/overworld_scripts";
      let labels = 0;
      const reasons = new Map<string, number>();
      const warnings = new Map<string, number>();
      for (const f of readdirSync(join(dir!, folder)).filter((x) => x.endsWith(".s"))) {
        const path = `${folder}/${f}`;
        const entry = index.file(path);
        if (!entry) continue;
        const body = text(path)!.split(/\r?\n/);
        // ラベルの次のラベルまでに applymovement があるラベル。
        for (let i = 0; i < entry.labels.length; i++) {
          const l = entry.labels[i]!;
          const end = entry.labels[i + 1]?.line ?? body.length + 1;
          if (!body.slice(l.line - 1, end - 1).some((row) => /^\s*applymovement/.test(row))) continue;
          const walker = new ScriptWalker({ index, commands, text });
          const a = walkScript(walker, l.name);
          const b = walkScript(new ScriptWalker({ index, commands, text }), l.name);
          expect(ops(b)).toEqual(ops(a));
          const last = a[a.length - 1]!;
          expect(last.type).toBe("stop");
          if (last.type === "stop" && last.reason === "inactive") {
            reasons.set("inactive", (reasons.get("inactive") ?? 0) + 1);
            continue;
          }
          if (last.type === "stop") reasons.set(last.reason, (reasons.get(last.reason) ?? 0) + 1);
          if (last.type === "stop" && last.reason === "limit") console.log(`limit: ${l.name} ${last.path}:${last.line}`);
          for (const e of a) if (e.type === "warning") warnings.set(`${e.kind} ${e.detail}`, (warnings.get(`${e.kind} ${e.detail}`) ?? 0) + 1);
          // 既定の答え（飛ばない）か、いつも飛ぶ答えのどちらかで applymovement に届く。
          const moves = (ev: WalkEvent[]) => ev.some((e) => e.type === "command" && (e.command.opcode === 0x4f || e.command.opcode === 0x50));
          const reached = moves(a) || moves(walkScript(new ScriptWalker({ index, commands, text }), l.name, () => true));
          expect(reached, l.name).toBe(true);
          labels++;
        }
      }
      console.log(`${name}: ${labels} ラベル、止まった理由 ${JSON.stringify(Object.fromEntries(reasons))}、注意 ${JSON.stringify(Object.fromEntries(warnings))}`);
      expect(labels).toBeGreaterThan(0);
      // はしごのスクリプト（callasm の結果で抜けるループ）は、既定の答えでは抜けないので打ち切りで止まる。
      expect(reasons.get("limit") ?? 0).toBeLessThanOrEqual(2);
    });

    it("カメラのスクリプト（ND は trainer_battle_scripts.s、Chronos は cracked_floor_scripts.s）", async () => {
      const read = (p: string) => readFileSync(join(dir!, p), "utf8");
      const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir!, n))).map(read);
      const commands = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
      const index = await buildScriptIndex(new NodeProjectFs(dir!));
      const text = (p: string) => (existsSync(join(dir!, p)) ? read(p) : null);
      const label = name === "ND" ? "TwoOpponentBattleShowMessage" : index.allLabels().find((l) => l.path.endsWith("cracked_floor_scripts.s"))?.name;
      if (!label || !index.findLabel(label)) return;
      // case の並びは「飛ぶ」で最初の行き先へ。
      const ev = walkScript(new ScriptWalker({ index, commands, text }), label, () => true);
      const cmds = ev.filter((e) => e.type === "command").map((e) => e.command);
      console.log(`${name} ${label}: ${cmds.map((c) => `${c.written}(${c.opcode.toString(16)})`).join(" ")} / ${JSON.stringify(ev[ev.length - 1])}`);
      expect(cmds.length).toBeGreaterThan(3);
      if (name === "ND") {
        // special CAMERA_START（0x113）と applymovement 0x8005
        expect(cmds.some((c) => c.opcode === 0x25 && c.args[0]?.value === 0x113)).toBe(true);
        expect(cmds.some((c) => c.opcode === 0x4f && c.args[0]?.value === 0x8005)).toBe(true);
      }
    });
  });
}
