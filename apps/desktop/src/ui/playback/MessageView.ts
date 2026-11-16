import { readMessageFrame, splitStringPages, type MessageFrameStyle } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { canvasOf } from "../canvas";

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

const color = (value: number): string => {
  const channel = (v: number) => ((v & 31) << 3) | ((v & 31) >> 2);
  return `rgb(${channel(value)},${channel(value >> 5)},${channel(value >> 10)})`;
};

/** 枠の下の本文確認。文字はシステムのフォントで、動的な置換文字は記号のまま見せる。 */
export function messageView(text: string, skin: MessageSkin | null): HTMLElement {
  const box = document.createElement("div"); box.dataset["autoId"] = "playback.message";
  if (!skin) {
    box.className = "playback-message"; box.title = t.neutralFrame;
    box.textContent = splitStringPages(text).map(page => page.lines.map(line => line.text).join("\n")).join("\n\n");
    return box;
  }
  box.className = "playback-message-pages"; box.title = t.messageFont;
  for (const page of splitStringPages(text)) for (let i = 0; i < page.lines.length; i += 2) {
    const frame = document.createElement("div"), body = document.createElement("div");
    frame.className = "playback-game-message";
    const canvas = canvasOf(skin.image);
    body.className = "playback-game-message-text"; body.textContent = page.lines.slice(i, i + 2).map(line => line.text).join("\n");
    body.style.color = color(skin.textColor); body.style.textShadow = `1px 1px ${color(skin.shadowColor)}`;
    frame.append(canvas, body); box.append(frame);
  }
  return box;
}
