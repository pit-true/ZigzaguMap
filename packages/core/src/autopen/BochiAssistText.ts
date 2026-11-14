import { PRIMARY_BLOCK_COUNT } from "../map/constants.js";
import { allSlotNamesOf, type AutoPenFile, type AutoPenPart, type AutoPenTilesetInfo, type PartCell, type PartGrid, type PartKind, type PartRole } from "./types.js";

/**
 * BochiBochiEditor の「マップ作成補助」の指定ファイル（`mapassist\*.txt`）を読む（#303。読み込みだけで、書き出しはしない）。
 *
 * 形（Bochi の画面で保存したもの）:
 * - `;` で始まる行は注釈。`[Tileset]` に `Name` `Kind`（1 か 2）`Game` `HeaderOffset`（16 進）`Fingerprint` `BlockCount`。
 * - `[Part]` ごとに `Name` `Kind`（Area・Edge・Stamp・Repeat）`Role` `Order`、主と副の両方を使うものは `Primary`
 *   `PrimaryGame` `PrimaryOffset`、枠は `Slot.<枠名>=幅,高さ;マス,マス,…`。
 * - マスは `タイルセット(1/2):ブロック番号(16 進):移動許可(16 進か --)`、空きは `-`。副のブロック番号は副の先頭を 0 とした番号。
 * - 読めない値のパーツは飛ばす（Bochi と同じ）。[Tileset] が無いか Kind が 1・2 でなければ null。
 */

const KINDS: Readonly<Record<string, PartKind>> = { Area: "fill", Edge: "edge", Stamp: "piece", Repeat: "repeat" };
const ROLES: Readonly<Record<string, PartRole>> = {
  Ground: "ground",
  Grass: "grass",
  Path: "path",
  Water: "water",
  Tree: "tree",
  Cliff: "cliff",
  Fence: "fence",
  Building: "building",
  Decoration: "decoration",
  Other: "other",
};

function parseCell(text: string): PartCell | null | undefined {
  const t = text.trim();
  if (t === "-") return null;
  const f = t.split(":");
  if (f.length !== 3) return undefined;
  const ts = f[0] === "1" ? 1 : f[0] === "2" ? 2 : 0;
  if (ts === 0 || !/^[0-9a-f]+$/i.test(f[1]!)) return undefined;
  const block = Number.parseInt(f[1]!, 16);
  if (block > 1023) return undefined;
  let movement: number | null = null;
  if (f[2] !== "--") {
    if (!/^[0-9a-f]+$/i.test(f[2]!)) return undefined;
    movement = Number.parseInt(f[2]!, 16);
    if (movement > 63) return undefined;
  }
  const global = ts === 2 ? PRIMARY_BLOCK_COUNT + block : block;
  if (global > 1023) return undefined;
  return { block: global, movement };
}

function parseGrid(text: string): PartGrid | null {
  const halves = text.split(";");
  if (halves.length !== 2) return null;
  const size = halves[0]!.split(",");
  if (size.length !== 2 || !/^\d+$/.test(size[0]!.trim()) || !/^\d+$/.test(size[1]!.trim())) return null;
  const width = Number(size[0]);
  const height = Number(size[1]);
  if (width < 1 || height < 1 || width > 255 || height > 255) return null;
  const list = halves[1]!.split(",");
  if (list.length !== width * height) return null;
  const cells: (PartCell | null)[] = [];
  for (const c of list) {
    const cell = parseCell(c);
    if (cell === undefined) return null;
    cells.push(cell);
  }
  return { width, height, cells };
}

interface PartDraft {
  name: string;
  kind: PartKind | null;
  role: PartRole;
  order: number;
  slots: Record<string, PartGrid>;
  primaryFingerprint: string;
  primaryGame: string;
  primaryOffset: number;
  broken: boolean;
}

function finish(d: PartDraft, index: number): AutoPenPart | null {
  if (d.broken || d.kind === null) return null;
  const allowed = new Set(allSlotNamesOf(d.kind));
  const slots: Record<string, PartGrid> = {};
  for (const [k, v] of Object.entries(d.slots)) if (allowed.has(k)) slots[k] = v;
  const name = d.name.trim() || `パーツ ${index + 1}`;
  const hasPrimary = d.primaryFingerprint.length > 0 || d.primaryOffset >= 0;
  return {
    name,
    kind: d.kind,
    role: d.role,
    order: d.order,
    slots,
    ...(hasPrimary ? { primary: { fingerprint: d.primaryFingerprint, game: d.primaryGame, headerAddress: d.primaryOffset } } : {}),
  };
}

/** Bochi の txt を読む（読めなければ null）。 */
export function parseBochiAssistText(text: string): AutoPenFile | null {
  let section = "";
  let sawTileset = false;
  let kind = 0;
  const info = { game: "", headerAddress: -1, fingerprint: "", blockCount: 0, name: "" };
  const parts: AutoPenPart[] = [];
  let draft: PartDraft | null = null;
  const flush = () => {
    if (draft) {
      const p = finish(draft, parts.length);
      if (p) parts.push(p);
    }
    draft = null;
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      flush();
      section = line.slice(1, -1);
      if (section === "Part") {
        draft = { name: "", kind: null, role: "other", order: parts.length, slots: {}, primaryFingerprint: "", primaryGame: "", primaryOffset: -1, broken: false };
      } else if (section === "Tileset") sawTileset = true;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (section === "Tileset") {
      if (key === "Name") info.name = value;
      else if (key === "Kind" && /^\d+$/.test(value)) kind = Number(value);
      else if (key === "Game") info.game = value;
      else if (key === "HeaderOffset" && /^[0-9a-f]+$/i.test(value)) info.headerAddress = Number.parseInt(value, 16);
      else if (key === "Fingerprint") info.fingerprint = value;
      else if (key === "BlockCount" && /^\d+$/.test(value)) info.blockCount = Number(value);
    } else if (section === "Part" && draft) {
      const d: PartDraft = draft;
      if (key === "Name") d.name = value;
      else if (key === "Order") {
        if (/^-?\d+$/.test(value)) d.order = Number(value);
      } else if (key === "Kind") {
        const k = KINDS[value];
        if (k) d.kind = k;
        else d.broken = true;
      } else if (key === "Role") {
        const r = ROLES[value];
        if (r) d.role = r;
        else d.broken = true;
      } else if (key === "Primary") d.primaryFingerprint = value;
      else if (key === "PrimaryGame") d.primaryGame = value;
      else if (key === "PrimaryOffset") {
        if (/^[0-9a-f]+$/i.test(value)) d.primaryOffset = Number.parseInt(value, 16);
      } else if (key.startsWith("Slot.")) {
        const grid = parseGrid(value);
        if (grid) d.slots[key.slice(5)] = grid;
        else d.broken = true;
      }
    }
  }
  flush();
  if (!sawTileset || (kind !== 1 && kind !== 2)) return null;
  const tileset: AutoPenTilesetInfo = { secondary: kind === 2, ...info };
  return { tileset, parts };
}
