import {
  createImage,
  drawMessageGlyphs,
  layoutMessage,
  MESSAGE_AREA,
  messageAreaImage,
  readMessageFrame,
  splitStringPages,
  type MessageFont,
  type MessageFrameStyle,
  type MessageItem,
  type MessageStop,
  type RgbaImage,
  type ScriptTextCodec,
} from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { toImageData } from "../canvas";
import { loadMessageCodec, loadMessageFont } from "./MessageFontLoader";

export type MessageSkin = NonNullable<ReturnType<typeof readMessageFrame>>;

/** 並べ方が確認できた枠だけを使う。未知の描画処理はゲーム風の枠で補わない。 */
export async function messageSkin(session: ProjectSession, sign: boolean): Promise<MessageSkin | null> {
  const rom = session.project.rom, o = session.project.game.offsets;
  let style: MessageFrameStyle | null = null;
  try {
    const first = rom.u32(o.messageFrameWriter), second = rom.u32(o.messageFrameWriter + 4);
    if (first === 0x4657b5f0 && second === 0x4645464e) style = sign ? "sign" : "vanilla";
    else if (first === 0xb082b510 && second === 0x94009c02 && await session.files.exists("src/message_box_frame.c")) {
      const source = (await session.files.readText("src/message_box_frame.c")).replace(/\s+/g, "");
      if (source.includes("sLeftTiles[6][2]={{0,1},{3,4},{5,6},{5,6},{7,8},{9,10}}") && source.includes("sRightInnerTiles[6]={12,13,14,14,15,16}") && source.includes("Chronos_FieldTalkWindowWrite")) style = sign ? "sign" : "chronos";
    }
  } catch { return null; }
  return style ? readMessageFrame(rom, sign ? o.signFrameTilesPointer : o.messageFrameTilesPointer, o.textWindowPalettesPointer, style) : null;
}

/** 画面に出すときの倍率（ROM の 1 画素を 2×2 で描く）。 */
const SCALE = 2;
/** 枠の画像（240×48）の中の窓の左上。 */
const AREA_IN_FRAME = { x: 16, y: 8 } as const;
/** 枠の分からないときの色（背景 1・文字 2・影 3）。 */
const NEUTRAL_PALETTE = Array.from({ length: 16 }, (_, i) => (i === 1 ? 0x7fff : i === 3 ? 0x5ad6 : i === 0 ? 0x7fff : 0x1084));
/** 補った字の枠の色（ゲームの色ではないことが分かる色）。 */
const FALLBACK_MARK = "#e0389a";

const rgb = (value: number): string => {
  const channel = (v: number) => ((v & 31) << 3) | ((v & 31) >> 2);
  return `rgb(${channel(value)},${channel(value >> 5)},${channel(value >> 10)})`;
};

/** 自動操作に返す、今のページの様子。 */
export interface MessageInfo {
  readonly index: number;
  readonly page: number;
  readonly pages: number;
  readonly reason: MessageStop["reason"] | null;
  readonly font: { kana: string | null; kanji: string | null | undefined } | null;
  readonly frame: boolean;
  /** 窓の左上（canvas の画素。倍率込み）と倍率。 */
  readonly origin: { x: number; y: number };
  readonly scale: number;
  readonly items: readonly { kind: MessageItem["kind"]; x: number; y: number; width: number; text: string; source?: string; reason?: string; code?: number; font?: number; colors: MessageItem["colors"] }[];
  readonly overflowRight: boolean;
  readonly overflowBelow: boolean;
}

/**
 * 再生のメッセージの窓（#497）。字は ROM のフォント（かな）と漢字対応パッチの漢字で描き、絵の無い字は確認用のフォントで点線の枠を付けて補う。
 * フォントは初めて文を出すときに読み、{@link dispose} で捨てる。ページ（`\p`・`\l`・ボタン待ち）は {@link advance} で進める。
 */
export class MessageRenderer {
  private loading: Promise<void> | null = null;
  private font: MessageFont | null = null;
  private codec: ScriptTextCodec | null = null;
  private loaded = false;
  private disposed = false;
  private layoutKey = "";
  private stops: MessageStop[] = [];
  private current = { index: -1, page: 0 };
  private lastInfo: MessageInfo | null = null;
  private lastBox: HTMLElement | null = null;

  /** `speaker` は話しかけた人物の見た目の番号（人物の台詞のフォント 4・5 を決める。ほかは null）。 */
  constructor(private readonly session: ProjectSession, readonly skin: MessageSkin | null, private readonly speaker: number | null = null) {}

  /** 読み込みが済むまで待つ（自動操作）。 */
  async ready(): Promise<void> { await this.loading; }

  /** 字が残っているページがあれば次へ進めて true。最後のページなら false（文を読み終えた）。 */
  advance(index: number): boolean {
    if (this.current.index !== index || !this.loaded) return false;
    if (this.current.page + 1 >= this.stops.length) return false;
    this.current.page++;
    return true;
  }

  /** フォントと覚えた絵を捨てる（再生を終えたとき）。 */
  dispose(): void {
    this.disposed = true;
    this.font = null; this.codec = null; this.stops = []; this.lastInfo = null; this.lastBox = null; this.layoutKey = "";
  }

  /** 今、画面に出ている窓の様子（出ていなければ null）。 */
  get info(): MessageInfo | null { return this.lastBox?.isConnected ? this.lastInfo : null; }

  /** 文 `index`（タイムラインの印の番号）の今のページを描いた要素。 */
  view(index: number, text: string): HTMLElement {
    const box = document.createElement("div"); box.dataset["autoId"] = "playback.message";
    box.className = "playback-message-window";
    if (!this.loaded) {
      box.textContent = t.messageText.loading;
      this.loading ??= this.load();
      void this.loading.then(() => { if (box.isConnected && !this.disposed) box.replaceWith(this.view(index, text)); });
      return box;
    }
    if (!this.font || !this.codec) {
      box.className = "playback-message"; box.title = t.messageText.noFont;
      box.textContent = splitStringPages(text).map(page => page.lines.map(line => line.text).join("\n")).join("\n\n");
      return box;
    }
    const key = `${index}\u0000${text}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.stops = layoutMessage(this.codec.encodeParts(text), this.font, undefined, this.font.speakerFont(this.speaker));
    }
    if (this.current.index !== index) this.current = { index, page: 0 };
    const page = Math.min(this.current.page, this.stops.length - 1), stop = this.stops[page]!;
    const palette = this.skin?.palette ?? NEUTRAL_PALETTE;
    const origin = this.skin ? AREA_IN_FRAME : { x: 0, y: 0 };
    let image: RgbaImage;
    if (this.skin) {
      image = createImage(this.skin.image.width, this.skin.image.height);
      image.data.set(this.skin.image.data);
      drawMessageGlyphs(image, stop.items, palette, origin);
    } else image = messageAreaImage(stop.items, palette);
    const canvas = document.createElement("canvas");
    canvas.width = image.width * SCALE; canvas.height = image.height * SCALE;
    canvas.className = "playback-message-canvas"; canvas.style.width = `${canvas.width}px`;
    const ctx = canvas.getContext("2d")!;
    const plain = document.createElement("canvas"); plain.width = image.width; plain.height = image.height;
    plain.getContext("2d")!.putImageData(toImageData(image), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(plain, 0, 0, canvas.width, canvas.height);
    this.drawOverlays(ctx, stop.items, palette, origin);

    const notes: string[] = [];
    const source = this.font.source;
    notes.push(t.messageText.fontFrom(source.kana ?? t.messageText.openedRom, source.kanji === undefined ? null : source.kanji ?? t.messageText.openedRom));
    const fallback = [...new Set(stop.items.flatMap(item => item.kind === "fallback" ? [item.text] : []))];
    if (fallback.length) notes.push(t.messageText.fallback(fallback.join(" ")));
    if (stop.items.some(item => item.kind === "placeholder")) notes.push(t.messageText.placeholder);
    if (stop.overflowRight) notes.push(t.messageText.overflowRight);
    if (stop.overflowBelow) notes.push(t.messageText.overflowBelow);
    canvas.title = notes.join("\n");

    const footer = document.createElement("div"); footer.className = "playback-message-footer";
    const pageText = document.createElement("span");
    pageText.textContent = `${t.messageText.page(page + 1, this.stops.length)}（${t.messageText.reason[stop.reason] ?? ""}）`;
    footer.append(pageText);
    for (const warning of [stop.overflowRight && t.messageText.overflowRight, stop.overflowBelow && t.messageText.overflowBelow]) {
      if (!warning) continue;
      const span = document.createElement("span"); span.className = "playback-message-warning"; span.textContent = warning; footer.append(span);
    }
    // 読み上げと自動操作のための本文（見た目には出さない）
    const hidden = document.createElement("span"); hidden.className = "playback-message-hidden";
    hidden.textContent = itemsText(stop.items);
    box.append(canvas, footer, hidden);
    this.lastBox = box;

    this.lastInfo = {
      index, page, pages: this.stops.length, reason: stop.reason,
      font: { kana: source.kana, kanji: source.kanji }, frame: !!this.skin,
      origin: { x: origin.x * SCALE, y: origin.y * SCALE }, scale: SCALE,
      items: stop.items.map(item => ({
        kind: item.kind, x: item.x, y: item.y, width: item.width, colors: item.colors,
        text: item.kind === "placeholder" ? `[${item.name}]` : item.text,
        ...(item.kind === "glyph" ? { source: item.source, code: item.code, font: item.font } : {}),
        ...(item.kind === "fallback" ? { reason: item.reason } : {}),
      })),
      overflowRight: stop.overflowRight, overflowBelow: stop.overflowBelow,
    };
    return box;
  }

  private async load(): Promise<void> {
    try {
      const [font, codec] = await Promise.all([loadMessageFont(this.session), loadMessageCodec(this.session)]);
      if (this.disposed) return;
      this.font = font; this.codec = codec;
    } catch {
      this.font = null;
    } finally {
      this.loaded = true;
    }
  }

  /** 補った字（確認用のフォント・点線の枠）とプレースホルダ（点線の箱と名前）。窓の外は描かない。 */
  private drawOverlays(ctx: CanvasRenderingContext2D, items: readonly MessageItem[], palette: readonly number[], origin: { x: number; y: number }): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(origin.x * SCALE, origin.y * SCALE, MESSAGE_AREA.width * SCALE, MESSAGE_AREA.height * SCALE);
    ctx.clip();
    ctx.textBaseline = "middle";
    for (const item of items) {
      if (item.kind === "glyph") continue;
      const x = (origin.x + item.x) * SCALE, y = (origin.y + item.y) * SCALE, w = item.width * SCALE, h = 12 * SCALE;
      ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
      if (item.kind === "fallback") {
        ctx.strokeStyle = FALLBACK_MARK; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = rgb(palette[item.colors.fg] ?? 0);
        ctx.font = `${item.text.length > 1 ? 12 : 18}px "Yu Gothic UI", "Meiryo", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(item.text, x + w / 2, y + h / 2, w);
      } else {
        ctx.strokeStyle = rgb(palette[item.colors.fg] ?? 0); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = rgb(palette[item.colors.fg] ?? 0);
        ctx.font = `14px "Yu Gothic UI", "Meiryo", sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(t.messageText.names[item.name] ?? item.name, x + 4, y + h / 2, w - 8);
      }
    }
    ctx.restore();
  }
}

/** 窓に見えている字を本文の形でつなぐ（行の間は空白）。 */
function itemsText(items: readonly MessageItem[]): string {
  let out = "", lastY: number | null = null;
  for (const item of items) {
    if (lastY !== null && item.y !== lastY) out += " ";
    lastY = item.y;
    out += item.kind === "placeholder" ? `[${item.name}]` : item.text;
  }
  return out;
}

