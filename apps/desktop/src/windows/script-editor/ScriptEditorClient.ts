import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { errorText } from "../../util/errors";
import {
  ScriptEditorEvents,
  type ScriptEditorEnvelope,
  type ScriptEditorHello,
  type ScriptEditorQuery,
  type ScriptEditorQueryEnvelope,
  type ScriptEditorReply,
  type ScriptEditorRequest,
  type ScriptOpenRequest,
} from "./protocol";

/** メインから届くものの受け手。 */
export interface ScriptEditorClientListener {
  open(request: ScriptOpenRequest): void;
  /** 問い合わせに答える（返した値が答え。投げたらエラーとして返す）。 */
  query(query: ScriptEditorQuery): Promise<unknown>;
}

/** エディタのウィンドウからメインウィンドウへの窓口（ワールドマップエディターの WorldMapClient と同じ形）。 */
export class ScriptEditorClient {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  /** 購読を始める。 */
  async connect(listener: ScriptEditorClientListener): Promise<void> {
    const win = getCurrentWebviewWindow();
    await win.listen<ScriptEditorReply>(ScriptEditorEvents.reply, (e) => {
      const reply = e.payload;
      const w = this.waiting.get(reply.id);
      if (!w) return;
      this.waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply.result);
      else w.reject(new Error(reply.error));
    });
    await win.listen<ScriptOpenRequest>(ScriptEditorEvents.open, (e) => listener.open(e.payload));
    await win.listen<ScriptEditorQueryEnvelope>(ScriptEditorEvents.query, (e) => {
      const { id, query } = e.payload;
      void listener
        .query(query)
        .then((result): ScriptEditorReply => ({ id, ok: true, result: result ?? null }))
        .catch((err: unknown): ScriptEditorReply => ({ id, ok: false, error: errorText(err) }))
        .then((reply) => emitTo("main", ScriptEditorEvents.answer, reply))
        .catch(() => undefined);
    });
  }

  /** 準備ができたことを知らせ、開くのを待っているファイルを受け取る。 */
  hello(): Promise<ScriptEditorHello> {
    return this.send({ type: "hello" }) as Promise<ScriptEditorHello>;
  }

  /** 保存したことを知らせる（返事は待たない）。 */
  saved(path: string): void {
    void this.send({ type: "saved", path }).catch(() => undefined);
  }

  /** エディタの個人設定を変えたことを知らせる（メインが settings.json に残す。返事は待たない）。 */
  setting(key: "scriptEditorTheme", value: string): void {
    void this.send({ type: "setting", key, value }).catch(() => undefined);
  }

  private send(request: ScriptEditorRequest): Promise<unknown> {
    const id = this.nextId++;
    const envelope: ScriptEditorEnvelope = { id, request };
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      emitTo("main", ScriptEditorEvents.request, envelope).catch((e: unknown) => {
        this.waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }
}
