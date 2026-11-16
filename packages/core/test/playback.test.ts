import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeProjectFs } from "../src/node/index.js";
import {
  buildPlaybackStart,
  buildScriptIndex,
  defaultFacingOf,
  defaultPlaybackHandlers,
  PLAYER_ID,
  ScriptCommandTable,
  ScriptIndex,
  signAllows,
  simulatePlayback,
  withPlaybackHandler,
  type MapEvents,
  type PersonEvent,
  type PlaybackActorInit,
  type PlaybackOptions,
  type PlaybackStart,
} from "../src/index.js";

const XSE = `
.macro end
.byte 0x02
.endm
.macro return
.byte 0x03
.endm
.macro goto destination:req
.byte 0x05
.word \\destination
.endm
.macro goto_if condition:req, destination:req
.byte 0x06
.byte \\condition
.4byte \\destination
.endm
.macro setvar var:req, value:req
.byte 0x16
.2byte \\var
.2byte \\value
.endm
.macro compare var:req, value:req
.byte 0x21
.2byte \\var
.2byte \\value
.endm
.macro checkflag flag:req
.byte 0x2b
.2byte \\flag
.endm
.macro setflag flag:req
.byte 0x29
.2byte \\flag
.endm
.macro callasm func:req
.byte 0x23
.word \\func
.endm
.macro special num:req
.byte 0x25
.2byte \\num
.endm
.macro waitstate
.byte 0x27
.endm
.macro wait time:req
.byte 0x28
.2byte \\time
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
.macro applymovement index:req, movements:req
.byte 0x4f
.2byte \\index
.4byte \\movements
.endm
.macro waitmovement index:req
.byte 0x51
.2byte \\index
.endm
.macro hidesprite index:req
.byte 0x53
.2byte \\index
.endm
.macro showsprite index:req
.byte 0x55
.2byte \\index
.endm
.macro moveobject index:req, x:req, y:req
.byte 0x57
.2byte \\index
.2byte \\x
.2byte \\y
.endm
.macro faceplayer
.byte 0x5a
.endm
.macro changeface localId:req, direction:req
.byte 0x5b
.2byte \\localId
.byte \\direction
.endm
.macro msg pointer:req
.byte 0x67
.word \\pointer
.endm
.macro yesnobox x:req, y:req
.byte 0x6e
.byte \\x
.byte \\y
.endm
.macro multichoice2 x:req, y:req, list:req, default:req, b:req
.byte 0x70
.byte \\x
.byte \\y
.byte \\list
.byte \\default
.byte \\b
.endm
.macro customchoice top:req, bottom:req
.byte 0x74
.word \\top
.word \\bottom
.endm
.equ PLAYER, 0xFF
.equ CAMERA, 0x7F
.equ walk_down, 0x10
.equ walk_up, 0x11
.equ walk_left, 0x12
.equ walk_right, 0x13
.equ jump_up, 0x4f
.equ exclaim, 0x62
.equ end_m, 0xFE
`;

const actor = (id: number, x: number, y: number, facing: PlaybackActorInit["facing"] = "down"): PlaybackActorInit => ({
  id,
  graphicsId: id === PLAYER_ID ? 0 : 5,
  x,
  y,
  elevation: 3,
  facing,
  defaultFacing: facing,
});

const defaultStart: PlaybackStart = { actors: [actor(PLAYER_ID, 5, 5, "up"), actor(1, 5, 3), actor(2, 8, 3)], talker: 1 };

function run(script: string, opts: Partial<PlaybackOptions> = {}) {
  const files: Record<string, string> = { "a.s": script };
  const index = new ScriptIndex();
  index.updateFile("a.s", script);
  const commands = ScriptCommandTable.build({ xseCommands: XSE });
  return simulatePlayback({ project: { index, commands, text: (p) => files[p] ?? null }, entry: "Main", start: defaultStart, ...opts });
}

/** 命令名（展開したマクロ）の実行フレーム。 */
const frameOf = (t: ReturnType<typeof run>, macro: string, nth = 0) => t.commands.filter((c) => c.command.macro === macro)[nth]?.frame;

describe("再生の計算（#451）", () => {
  it("高さを移動先から読み、固定中・高さ15の出入り・自由な高さ0では前の優先順位を保つ", () => {
    const script = "Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte walk_right, walk_right, walk_right, walk_right, walk_right, end_m\n";
    const t = run(script, { elevationAt: x => new Map([[5, 3], [6, 4], [7, 15], [8, 6], [9, 0], [10, 3]]).get(x) ?? 3 });
    const elevation = (f: number) => t.stateAt(f).actors.find(a => a.id === 1)!.elevation;
    expect([0, 16, 32, 48, 64].map(elevation)).toEqual([4, 4, 4, 4, 3]);
    const hold = run("Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte 0x6a, walk_right, 0x6b, walk_right, end_m\n", { elevationAt: x => x >= 7 ? 6 : x === 6 ? 4 : 3 });
    expect(hold.stateAt(1).actors.find(a => a.id === 1)).toMatchObject({ elevation: 3, fixedPriority: true });
    expect(hold.stateAt(17).actors.find(a => a.id === 1)).toMatchObject({ elevation: 4, fixedPriority: false });
    expect(hold.stateAt(18).actors.find(a => a.id === 1)).toMatchObject({ elevation: 6, fixedPriority: false });
    // 逆順で問い合わせても、途中を飛ばしても同じ高さになる。
    expect([64, 0, 48, 16].map(elevation)).toEqual([3, 4, 4, 4]);
    const vertical = run("Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte 0x6a, walk_down, 0x6b, walk_down, end_m\n");
    const subpriority = (f: number) => vertical.stateAt(f).actors.find(a => a.id === 1)!.subpriority;
    expect(subpriority(0)).toBe(140);
    expect(subpriority(16)).toBe(140);
    expect(subpriority(17)).toBeUndefined();
  });

  it("歩き 3 回 → waitmovement → 向き変え: F+T+2", () => {
    const t = run("Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tchangeface 1 2\n\tend\nm: .byte walk_down, walk_down, walk_down, end_m\n");
    expect(t.segments.map((s) => [s.start, s.end, s.toY])).toEqual([
      [0, 15, 4],
      [16, 31, 5],
      [32, 47, 6],
    ]);
    expect(frameOf(t, "changeface")).toBe(50);
    // 1 歩目の 1 画素は命令を渡したフレームに動く。論理の位置は歩き始めで行き先に変わる。
    const s0 = t.stateAt(0).actors.find((a) => a.id === 1)!;
    expect(s0).toMatchObject({ pixelY: 3 * 16 + 1, tileY: 4, sprite: "walk", actionFrame: 0, movementId: 0x10 });
    expect(t.stateAt(15).actors.find((a) => a.id === 1)).toMatchObject({ pixelY: 4 * 16, actionFrame: 15 });
    expect(t.stateAt(47).actors.find((a) => a.id === 1)).toMatchObject({ pixelY: 6 * 16, tileY: 6 });
    expect(t.stateAt(49).actors.find((a) => a.id === 1)).toMatchObject({ facing: "down", sprite: "stand" });
    expect(t.stateAt(50).actors.find((a) => a.id === 1)).toMatchObject({ facing: "up" });
    // 区間の元の位置（applymovement の行と、移動データの何番目か）
    expect(t.segments[1]).toMatchObject({ command: { line: 1 }, movementLabel: "m", stepIndex: 1, step: { line: 5, text: "walk_down" } });
  });

  it("2 人の同時移動と、動いている人物への applymovement", () => {
    const t = run("Main:\n\tapplymovement 1 m\n\tapplymovement 2 m\n\tapplymovement 1 m\n\twaitmovement 2\n\tend\nm: .byte walk_left, walk_left, end_m\n");
    expect(t.segmentsOf(1).map((s) => s.start)).toEqual([0, 16]);
    expect(t.segmentsOf(2).map((s) => s.start)).toEqual([0, 16]);
    expect(t.markers.filter((m) => m.kind === "ignored").map((m) => m.frame)).toEqual([0]);
    expect(frameOf(t, "end")).toBe(34);
  });

  it("wait n は s+n+1、wait の後の命令", () => {
    const t = run("Main:\n\twait 10\n\tchangeface 1 3\n\twait 0x1\n\tend\n");
    expect(frameOf(t, "changeface")).toBe(11);
    expect(frameOf(t, "end")).toBe(13);
  });

  it("消す・出す・移す、faceplayer、変数での人物の指定", () => {
    const t = run(
      "Main:\n\thidesprite 2\n\twait 1\n\tshowsprite 2\n\tmoveobject 1 0 0\n\tfaceplayer\n\tsetvar 0x8005 2\n\tapplymovement 0x8005 m\n\twaitmovement 0\n\tend\nm: .byte walk_right, end_m\n",
    );
    expect(t.stateAt(0).actors.find((a) => a.id === 2)).toMatchObject({ present: false, visible: false });
    expect(t.stateAt(2).actors.find((a) => a.id === 2)).toMatchObject({ present: true, visible: true });
    // faceplayer: 主人公（上向き）と逆の下を向く
    expect(t.stateAt(2).actors.find((a) => a.id === 1)).toMatchObject({ tileX: 0, tileY: 0, facing: "down" });
    expect(t.segmentsOf(2)).toHaveLength(1);
    expect(t.segmentsOf(2)[0]).toMatchObject({ start: 2, toX: 9 });
  });

  it("主人公を動かす（マップに置かなくても）、ジャンプの高さと影、頭の上の印", () => {
    const t = run("Main:\n\tapplymovement PLAYER m\n\twaitmovement 0\n\tend\nm: .byte exclaim, jump_up, end_m\n");
    const p = (f: number) => t.stateAt(f).actors.find((a) => a.id === PLAYER_ID)!;
    expect(p(0).mark).toEqual({ mark: "exclaim", frame: 0 });
    expect(p(1)).toMatchObject({ sprite: "jump", shadow: true, height: -2, tileY: 4 });
    expect(p(5).mark).toEqual({ mark: "exclaim", frame: 5 });
    expect(p(16)).toMatchObject({ height: 0, pixelY: 4 * 16 });
  });

  it("分岐: 値の分かる比べ方は計算し、分からなければ答えの表で、無ければ飛ばない", () => {
    const known = run("Main:\n\tsetvar 0x4001 3\n\tcompare 0x4001 3\n\tgoto_if 1 Yes\n\tend\nYes:\n\tchangeface 1 4\n\tend\n");
    expect(known.markers.find((m) => m.kind === "branch")!.branch).toMatchObject({ taken: true, known: true });
    const script = "Main:\n\tcompare 0x4002 3\n\tgoto_if 1 Yes\n\tend\nYes:\n\tchangeface 1 4\n\tend\n";
    const no = run(script);
    const b = no.markers.find((m) => m.kind === "branch")!.branch!;
    expect(b).toMatchObject({ taken: false, known: false, key: "a.s:2:0#1" });
    const yes = run(script, { answers: new Map([[b.key, true]]) });
    expect(yes.markers.find((m) => m.kind === "branch")!.branch!.taken).toBe(true);
    expect(yes.stateAt(yes.lastFrame).actors.find((a) => a.id === 1)!.facing).toBe("right");
    // checkflag は立てたフラグなら分かる
    const flag = run("Main:\n\tsetflag 0x200\n\tcheckflag 0x200\n\tgoto_if 1 Yes\n\tend\nYes:\n\tend\n");
    expect(flag.markers.find((m) => m.kind === "branch")!.branch).toMatchObject({ taken: true, known: true });
  });

  it("選択肢: 既定の答え（はい・既定の項目・上）で計算し、答えの表で替える", () => {
    const script = "Main:\n\tmsgbox Q 5\n\tcompare 0x800d 1\n\tgoto_if 1 Yes\n\tchangeface 1 3\n\tend\nYes:\n\tchangeface 1 4\n\tend\n";
    const first = run(script);
    const choice = first.markers.find((m) => m.kind === "choice")!;
    expect(choice.detail).toBe("Q");
    expect(choice.choice).toMatchObject({ kind: "yesno", value: 1, defaulted: true, options: [{ value: 1, name: "yes" }, { value: 0, name: "no" }] });
    expect(first.markers.find((m) => m.kind === "branch")!.branch).toMatchObject({ taken: true, known: true });
    expect(first.stateAt(first.lastFrame).actors.find((a) => a.id === 1)!.facing).toBe("right");
    const no = run(script, { choices: new Map([[choice.choice!.key, 0]]) });
    expect(no.markers.find((m) => m.kind === "choice")!.choice).toMatchObject({ value: 0, defaulted: false });
    expect(no.stateAt(no.lastFrame).actors.find((a) => a.id === 1)!.facing).toBe("left");
    // yesnobox と multichoice2（既定の項目）、customchoice（上が 0）。同じ行を 2 度通ると別の鍵。
    const many = run("Main:\n\tyesnobox 0 0\n\tmultichoice2 0 0 3 2 0\n\tsetvar 0x4001 1\nAgain:\n\tcustomchoice Top Bottom\n\tcompare 0x4001 1\n\tsetvar 0x4001 2\n\tgoto_if 1 Again\n\tend\n");
    const marks = many.markers.filter((m) => m.kind === "choice").map((m) => m.choice!);
    expect(marks.map((m) => [m.kind, m.value])).toEqual([["yesno", 1], ["multichoice", 2], ["custom", 0], ["custom", 0]]);
    expect(marks[1]!.options).toBeNull();
    expect(marks[2]!.options).toEqual([{ value: 0, name: "Top" }, { value: 1, name: "Bottom" }]);
    expect(new Set(marks.map((m) => m.key)).size).toBe(4);
    expect(marks[3]!.key.replace(/#1$/, "#0")).toBe(marks[2]!.key);
  });

  it("文は長さ 0 の印、打ち切り（60 秒）", () => {
    const t = run("Main:\n\tmsgbox Text 6\n\tend\n");
    expect(t.markers.find((m) => m.kind === "message")).toMatchObject({ frame: 0, detail: "Text" });
    // msg 0x0 は前の loadpointer の文。
    const loaded = run("Main:\n\tloadpointer 0x0 Hello\n\tmsg 0x0\n\tmsg Direct\n\tend\n");
    expect(loaded.markers.filter((m) => m.kind === "message").map((m) => m.detail)).toEqual(["Hello", "Direct"]);
    const loop = run("Main:\n\twait 1\n\tgoto Main\n");
    expect(loop.lastFrame).toBe(3599);
    expect(loop.markers.some((m) => m.kind === "limit")).toBe(true);
  });

  it("同じ入力からは同じタイムライン", () => {
    const s = "Main:\n\tapplymovement 1 m\n\tapplymovement PLAYER m\n\twaitmovement 0\n\tend\nm: .byte walk_down, walk_left, end_m\n";
    const a = run(s);
    const b = run(s);
    expect(JSON.stringify(b.segments)).toBe(JSON.stringify(a.segments));
    expect(JSON.stringify(b.stateAt(20))).toBe(JSON.stringify(a.stateAt(20)));
  });

  it("コマ送りの点: 歩き 1 回は 0・8・15", () => {
    const t = run("Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte walk_down, end_m\n");
    const k = t.keyFrames();
    expect(k.slice(0, 3)).toEqual([0, 8, 15]);
    expect(k[k.length - 1]).toBe(t.lastFrame);
  });

  it("コマ送りの点: 2 人の重なりはまとめ、1 フレーム差の点は 1 つ、1 フレームの命令は 1 点", () => {
    const two = run("Main:\n\tapplymovement 1 m\n\tapplymovement PLAYER p\n\twaitmovement 0\n\tend\nm: .byte walk_down, end_m\np: .byte walk_down, walk_down, end_m\n");
    expect(two.segmentsOf(1).map((s) => [s.start, s.end])).toEqual([[0, 15]]);
    expect(two.segmentsOf(PLAYER_ID).map((s) => [s.start, s.end])).toEqual([[0, 15], [16, 31]]);
    // 15 と 16 は 1 フレーム差なので 15 にまとめる。
    expect(two.keyFrames().slice(0, 5)).toEqual([0, 8, 15, 24, 31]);
    const face = run("Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte 0x00, walk_down, end_m\n");
    const [turn, walk] = face.segmentsOf(1);
    expect(turn!.end - turn!.start).toBe(0);
    const k = face.keyFrames();
    expect(k.filter((f) => f >= turn!.start && f <= turn!.end)).toHaveLength(1);
    expect(k).toContain(walk!.start + 8);
  });

  it("計算の時間: 命令 200 個・人物 16 人で 5ms 以内（中央値）", () => {
    const lines = ["Main:"];
    for (let i = 0; i < 100; i++) {
      lines.push(`\tapplymovement ${(i % 15) + 1} m`);
      if (i % 15 === 14) lines.push("\twaitmovement 0");
    }
    for (let i = lines.length; i < 201; i++) lines.push("\tchangeface 1 2");
    lines.push("\twaitmovement 0", "\tend", "m: .byte walk_down, walk_up, end_m");
    const script = lines.join("\n") + "\n";
    const start: PlaybackStart = { actors: [actor(PLAYER_ID, 0, 0), ...Array.from({ length: 15 }, (_, i) => actor(i + 1, i, 2))], talker: null };
    // 命令表と索引は再生の前に一度だけ作る（画面でも同じ）ので、計る範囲に入れない。
    const index = new ScriptIndex();
    index.updateFile("a.s", script);
    const commands = ScriptCommandTable.build({ xseCommands: XSE });
    const project = { index, commands, text: (p: string) => (p === "a.s" ? script : null) };
    simulatePlayback({ project, entry: "Main", start });
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      simulatePlayback({ project, entry: "Main", start });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`再生の計算: 中央値 ${times[7]!.toFixed(2)}ms`);
    expect(times[7]!).toBeLessThan(5);
  });
});

describe("カメラ、揺れ、callasm の表（#452）", () => {
  it("カメラの開始・移動・終了。画面は追う相手の移動だけ動き、終了で戻さない", () => {
    const t = run(
      "Main:\n\tspecial 0x113\n\tapplymovement CAMERA m\n\twaitmovement 0\n\tspecial 0x114\n\twait 1\n\tend\nm: .byte walk_up, jump_up, end_m\n",
    );
    const cam0 = t.stateAt(0).camera;
    // 0 フレーム目に 1 画素動く
    expect(cam0).toMatchObject({ target: 0x7f, x: 80, y: 79 });
    expect(t.stateAt(15).camera).toMatchObject({ x: 80, y: 64 });
    // ジャンプの高さでは画面は動かない（マスの移動の分だけ）
    const mid = t.stateAt(20);
    expect(mid.camera.y).toBe(64 - 5);
    expect(mid.actors.find((a) => a.id === 0x7f)).toMatchObject({ visible: false, graphicsId: -1 });
    const end = t.stateAt(t.lastFrame);
    expect(end.camera).toMatchObject({ target: PLAYER_ID, x: 80, y: 48 });
    expect(end.actors.find((a) => a.id === 0x7f)!.present).toBe(false);
    expect(t.markers.filter((m) => m.kind === "camera").map((m) => m.detail)).toEqual(["CAMERA_START", "CAMERA_END"]);
  });

  it("ND のカメラの所: MoveCameraToTrainerB → applymovement 0x8005 で 1 マス動いて戻る", () => {
    const t = run(
      "Main:\n\tspecial 0x113\n\tcallasm MoveCameraToTrainerB\n\tapplymovement 0x8005 up\n\twaitmovement 0\n\tcallasm MoveCameraToTrainerB\n\tapplymovement 0x8005 down\n\twaitmovement 0\n\tspecial 0x114\n\tend\nup: .byte walk_up, end_m\ndown: .byte walk_down, end_m\n",
    );
    expect(t.segmentsOf(0x7f).map((s) => [s.fromY, s.toY])).toEqual([
      [5, 4],
      [4, 5],
    ]);
    expect(t.stateAt(15).camera.y).toBe(64);
    expect(t.stateAt(t.lastFrame).camera).toMatchObject({ target: PLAYER_ID, x: 80, y: 80 });
  });

  it("揺れの位置とフレーム数、waitstate", () => {
    const t = run("Main:\n\tsetvar 0x8004 2\n\tsetvar 0x8005 0\n\tsetvar 0x8006 4\n\tsetvar 0x8007 3\n\tspecial 0x136\n\twaitstate\n\tend\n");
    expect(t.shakes).toEqual([{ start: 0, end: 12, dx: 0, dy: 2, interval: 3 }]);
    expect(t.stateAt(0).camera.shakeY).toBe(2);
    expect(t.stateAt(3).camera.shakeY).toBe(-2);
    expect(t.stateAt(12).camera.shakeY).toBe(0);
    expect(frameOf(t, "end")).toBe(13);
  });

  it("登録の無い callasm・special は印だけ。表に 1 行足すと処理が動く", () => {
    const script = "Main:\n\tcallasm SomethingElse\n\tspecial 0x999\n\tend\n";
    const t = run(script);
    expect(t.markers.filter((m) => m.kind === "unhandled").map((m) => m.detail)).toEqual(["callasm SomethingElse", "special 0x999"]);
    const handlers = withPlaybackHandler(defaultPlaybackHandlers("nd"), { callasm: "SomethingElse" }, { name: "x", run: (ctx) => ctx.marker("camera", "x") });
    const u = run(script, { handlers });
    expect(u.markers.filter((m) => m.kind === "unhandled")).toHaveLength(1);
    expect(u.markers.some((m) => m.kind === "camera" && m.detail === "x")).toBe(true);
  });
});

const persons: PersonEvent[] = [
  { localId: 1, graphicsId: 5, kind: 0, padding1: 0, x: 4, y: 4, elevation: 3, movementType: 9, movementRangeX: 0, movementRangeY: 0, padding2: 0, trainerType: 0, trainerRangeOrBerryTree: 0, script: 0, flag: 0x30, padding3: 0 },
  { localId: 2, graphicsId: 6, kind: 0, padding1: 0, x: 7, y: 2, elevation: 3, movementType: 7, movementRangeX: 0, movementRangeY: 0, padding2: 0, trainerType: 0, trainerRangeOrBerryTree: 0, script: 0, flag: 0, padding3: 0 },
];
const events: MapEvents = {
  persons,
  warps: [{ x: 3, y: 9, elevation: 0, warpId: 0, map: 0, bank: 0 }],
  traps: [{ x: 6, y: 6, elevation: 3, padding1: 0, variable: 0x4050, value: 1, padding2: 0, script: 0 }],
  signs: [0, 1, 2, 3, 4].map((kind) => ({ x: 10, y: 10, elevation: 0, kind, padding: 0, content: { type: "script" as const, script: 0 } })),
};

describe("再生の始めの状態（#453）", () => {
  it("人物に話しかける: 下のマスで上を向く（下が壁でも）。仮の主人公があればその位置から人物の方へ", () => {
    const s = buildPlaybackStart({ events, trigger: { kind: "person", localId: 1 }, gender: "male" });
    expect(s.player).toEqual({ x: 4, y: 5, facing: "up" });
    expect(s.talker).toBe(1);
    expect(s.vars!.get(0x800f)).toBe(1);
    const p = buildPlaybackStart({ events, trigger: { kind: "person", localId: 1 }, gender: "female", provisionalPlayer: { x: 1, y: 4, facing: "down" } });
    expect(p.player).toEqual({ x: 1, y: 4, facing: "right" });
    expect(p.actors.find((a) => a.id === PLAYER_ID)!.graphicsId).toBe(7);
  });

  it("看板の向きの条件 5 種", () => {
    const sides = [0, 1, 2, 3, 4].map((i) => buildPlaybackStart({ events, trigger: { kind: "sign", index: i }, gender: "male" }).player);
    expect(sides).toEqual([
      { x: 10, y: 11, facing: "up" },
      { x: 10, y: 11, facing: "up" },
      { x: 10, y: 9, facing: "down" },
      { x: 9, y: 10, facing: "right" },
      { x: 11, y: 10, facing: "left" },
    ]);
    expect(signAllows(3, "right")).toBe(true);
    expect(signAllows(3, "up")).toBe(false);
  });

  it("踏むスクリプトは条件を返し、マップスクリプトは仮の主人公か最初のワープ", () => {
    const t = buildPlaybackStart({ events, trigger: { kind: "trap", index: 0 }, gender: "male" });
    expect(t.player).toEqual({ x: 6, y: 6, facing: "down" });
    expect(t.trapCondition).toEqual({ variable: 0x4050, value: 1 });
    expect(buildPlaybackStart({ events, trigger: { kind: "map" }, gender: "male" }).player).toEqual({ x: 3, y: 9, facing: "down" });
    expect(buildPlaybackStart({ events, trigger: { kind: "map" }, gender: "male", provisionalPlayer: { x: 2, y: 2, facing: "left" } }).player).toEqual({ x: 2, y: 2, facing: "left" });
  });

  it("人物は全員居て、外した人物は居ない。向きは移動タイプの基本の向き", () => {
    const s = buildPlaybackStart({ events, trigger: { kind: "map" }, gender: "male", absent: [2] });
    expect(s.actors.find((a) => a.id === 1)).toMatchObject({ facing: "left", present: true, flag: 0x30 });
    expect(s.actors.find((a) => a.id === 2)).toMatchObject({ facing: "up", present: false });
    expect(defaultFacingOf(8)).toBe("down");
    expect(defaultFacingOf(10)).toBe("right");
  });

  it("1 コマ目の向きを変えると faceplayer の結果が変わる", () => {
    const script = "Main:\n\tfaceplayer\n\tend\n";
    const a = run(script, { start: buildPlaybackStart({ events, trigger: { kind: "person", localId: 1 }, gender: "male" }) });
    expect(a.stateAt(a.lastFrame).actors.find((x) => x.id === 1)!.facing).toBe("down");
    const b = run(script, { start: buildPlaybackStart({ events, trigger: { kind: "person", localId: 1 }, gender: "male", facing: "left" }) });
    expect(b.stateAt(b.lastFrame).actors.find((x) => x.id === 1)!.facing).toBe("right");
  });
});

const ndDir = process.env.ZIGZAGU_ND_DIR;

describe.skipIf(!ndDir || !existsSync(join(ndDir ?? "", "xse_commands.s")))("実フォルダの再生（ND）", () => {
  it("trainer_battle_scripts.s のカメラの所が、画面を 1 マス動かして戻る", async () => {
    const read = (p: string) => readFileSync(join(ndDir!, p), "utf8");
    const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(ndDir!, n))).map(read);
    const commands = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
    const index = await buildScriptIndex(new NodeProjectFs(ndDir!));
    const text = (p: string) => (existsSync(join(ndDir!, p)) ? read(p) : null);
    const start: PlaybackStart = { actors: [actor(PLAYER_ID, 10, 10, "up"), actor(1, 10, 6)], talker: 1 };
    const first = simulatePlayback({ project: { index, commands, text }, entry: "TwoOpponentBattleShowMessage", start });
    // MoveCameraToTrainerB の向きは分からないので、case の分岐は画面で選ぶ。上を選ぶ（2 つ目の case の分岐）。
    const branches = first.markers.filter((m) => m.kind === "branch" && !m.branch!.known);
    expect(branches.length).toBeGreaterThan(0);
    const answers = new Map<string, boolean>();
    // 1 回目の WalkCall は上（case UP）、2 回目は下（case 0）。
    const keyOf = (n: number, visit: number) => `${branches.filter((b) => b.branch!.key.endsWith(`#${visit}`))[n]!.branch!.key}`;
    answers.set(keyOf(2, 1), true);
    const second = simulatePlayback({ project: { index, commands, text }, entry: "TwoOpponentBattleShowMessage", start, answers });
    const b2 = second.markers.filter((m) => m.kind === "branch" && !m.branch!.known && m.branch!.key.endsWith("#2"));
    answers.set(b2[0]!.branch!.key, true);
    const t = simulatePlayback({ project: { index, commands, text }, entry: "TwoOpponentBattleShowMessage", start, answers });
    const cam = t.segmentsOf(0x7f).map((s) => [s.movementLabel, s.fromY, s.toY]);
    console.log(`ND のカメラ: ${JSON.stringify(cam)}、最後 ${t.lastFrame} フレーム、印 ${t.markers.map((m) => m.kind).join(",")}`);
    expect(cam).toEqual([
      ["m_WalkUp", 10, 9],
      ["m_WalkDown", 9, 10],
    ]);
    const end = t.stateAt(t.lastFrame).camera;
    expect(end).toMatchObject({ target: PLAYER_ID, x: 160, y: 160 });
  });

  it("customchoice の答えで、後の cond の行き先が変わる", async () => {
    const read = (p: string) => readFileSync(join(ndDir!, p), "utf8");
    const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(ndDir!, n))).map(read);
    const commands = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
    const index = await buildScriptIndex(new NodeProjectFs(ndDir!));
    const text = (p: string) => (existsSync(join(ndDir!, p)) ? read(p) : null);
    const start: PlaybackStart = { actors: [actor(PLAYER_ID, 10, 10, "up")], talker: null };
    const run = (choices?: Map<string, number>) => simulatePlayback({ project: { index, commands, text }, entry: "customMultiChoiceTest", start, ...(choices ? { choices } : {}) });
    const top = run();
    const choice = top.markers.find((m) => m.kind === "choice")!;
    expect(choice.choice).toMatchObject({ kind: "custom", value: 0, options: [{ value: 0, name: "gText_CustomMultiChoiceTestGraffiti" }, { value: 1, name: "gText_CustomMultiChoiceTestClean" }] });
    const target = (t: ReturnType<typeof run>) => t.markers.find((m) => m.kind === "branch")!.branch!;
    expect(target(top)).toMatchObject({ known: true, taken: true, target: "customMultiChoiceTestGraffiti" });
    const bottom = run(new Map([[choice.choice!.key, 1]]));
    expect(target(bottom)).toMatchObject({ known: true, taken: false });
    expect(bottom.commands.some((c) => c.command.args.some((a) => a.text === "gText_CustomMultiChoiceTestCancel"))).toBe(true);
  });
});
