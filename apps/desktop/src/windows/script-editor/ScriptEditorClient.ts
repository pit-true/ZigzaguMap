import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PendingReplies, replyOf } from "../../util/pendingReplies";
import {
  ScriptEditorEvents,
  ScriptEditorNoticeEvents,
  handleMessage,
  type MessageHandlers,
  type MessageOf,
  type ScriptEditorEnvelope,
  type ScriptEditorHello,
  type ScriptEditorNoticeMap,
  type ScriptEditorQueryEnvelope,
  type ScriptEditorQueryMap,
  type ScriptEditorReply,
  type ScriptEditorRequestMap,
} from "./protocol";

/** メインから届くものの受け手。 */
export interface ScriptEditorClientListener {
  /** 知らせ（ファイルを開く・ビルドする・ROM のスクリプトを開く）の受け手。種類ごとに 1 つ。 */
  readonly notices: { readonly [K in keyof ScriptEditorNoticeMap]: (payload: ScriptEditorNoticeMap[K]) => void };
  /** 問い合わせの答え方（種類ごとに 1 つ。返した値が答え。投げたらエラーとして返す）。 */
  readonly queries: MessageHandlers<ScriptEditorQueryMap>;
}

/** エディタのウィンドウからメインウィンドウへの窓口（ワールドマップエディターの WorldMapClient と同じ形）。 */
export class ScriptEditorClient {
  private readonly pending = new PendingReplies();

  /** 購読を始める。 */
  async connect(listener: ScriptEditorClientListener): Promise<void> {
    const win = getCurrentWebviewWindow();
    await win.listen<ScriptEditorReply>(ScriptEditorEvents.reply, (e) => this.pending.settle(e.payload));
    for (const kind of Object.keys(ScriptEditorNoticeEvents) as (keyof ScriptEditorNoticeMap)[]) {
      const on = listener.notices[kind] as (payload: unknown) => void;
      await win.listen<unknown>(ScriptEditorNoticeEvents[kind], (e) => on(e.payload));
    }
    await win.listen<ScriptEditorQueryEnvelope>(ScriptEditorEvents.query, (e) => {
      const { id, query } = e.payload;
      void replyOf(id, () => handleMessage(listener.queries, query))
        .then((reply) => emitTo("main", ScriptEditorEvents.answer, reply))
        .catch(() => undefined);
    });
  }

  /** 準備ができたことを知らせ、開くのを待っているファイルを受け取る。 */
  hello(): Promise<ScriptEditorHello> {
    return this.request({ type: "hello" });
  }

  /** 保存したことを知らせる（返事は待たない）。 */
  saved(path: string): void {
    void this.request({ type: "saved", path }).catch(() => undefined);
  }

  /** エディタの個人設定を変えたことを知らせる（メインが settings.json に残す。返事は待たない）。 */
  setting(key: "scriptEditorTheme", value: string): void {
    void this.request({ type: "setting", key, value }).catch(() => undefined);
  }

  /** メインへ要求を送り、返事を待つ（返事の型は種類で決まる）。 */
  request<K extends keyof ScriptEditorRequestMap>(request: MessageOf<ScriptEditorRequestMap, K>): Promise<ScriptEditorRequestMap[K]["reply"]> {
    const { id, reply, fail } = this.pending.open();
    const envelope = { id, request } as ScriptEditorEnvelope;
    emitTo("main", ScriptEditorEvents.request, envelope).catch(fail);
    return reply as Promise<ScriptEditorRequestMap[K]["reply"]>;
  }
}
