import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  TOOL_MESSAGE_EVENT,
  TOOL_REQUEST_EVENT,
  type ToolKind,
  type ToolMessage,
  type ToolRequest,
  type ToolSnapshot,
  type ToolUiState,
} from "./protocol";

/** 要求の中身（送り主と番号は ToolClient が付ける）。 */
type RequestBody = ToolRequest extends infer R ? (R extends ToolRequest ? Omit<R, "from" | "id"> : never) : never;

/**
 * 別ウィンドウ側の、メインウィンドウとの接続。要求を送って返事を待ち、
 * メインから届くタイルセットの写しと共有の表示の状態を持つ。
 */
export class ToolClient {
  snapshot: ToolSnapshot = { version: 0, map: null, primary: null, secondary: null };
  ui: ToolUiState = { palette: 0, preview: {} };
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly snapshotListeners = new Set<() => void>();
  private readonly uiListeners = new Set<() => void>();

  private constructor(readonly kind: ToolKind) {}

  /** メインにつなぎ、最初の写しを受け取る。 */
  static async connect(kind: ToolKind): Promise<ToolClient> {
    const client = new ToolClient(kind);
    await getCurrentWebviewWindow().listen<ToolMessage>(TOOL_MESSAGE_EVENT, (e) => client.onMessage(e.payload));
    const first = (await client.request({ op: "hello" })) as { snapshot: ToolSnapshot; ui: ToolUiState };
    client.snapshot = first.snapshot;
    client.ui = first.ui;
    return client;
  }

  /** 要求を送り、返事を待つ（失敗なら Error）。 */
  request(body: RequestBody): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      emitTo("main", TOOL_REQUEST_EVENT, { ...body, from: this.kind, id }).catch((e: unknown) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** コマンドをメインの CommandBus で実行する。 */
  execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request({ op: "execute", name, args });
  }

  /** 共有の表示の状態を変える。 */
  setUi(patch: { palette?: number; preview?: Record<number, readonly number[]> }): Promise<unknown> {
    return this.request({ op: "setUi", ...patch });
  }

  /** 送った要求の返事が全部届くまで待つ（自動操作の後始末用。`timeout` ミリ秒で諦める）。 */
  async whenIdle(timeout = 5000): Promise<void> {
    const end = performance.now() + timeout;
    while (this.pending.size > 0 && performance.now() < end) await new Promise((r) => setTimeout(r, 10));
  }

  /** 写しが変わったとき。 */
  onSnapshot(listener: () => void): void {
    this.snapshotListeners.add(listener);
  }

  /** 共有の表示の状態が変わったとき（写しが変わったときも呼ぶ）。 */
  onUi(listener: () => void): void {
    this.uiListeners.add(listener);
  }

  private onMessage(message: ToolMessage): void {
    switch (message.type) {
      case "reply": {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id);
        if (message.ok) p.resolve(message.result);
        else p.reject(new Error(message.error ?? "失敗しました"));
        return;
      }
      case "snapshot":
        this.snapshot = message.snapshot;
        this.ui = message.ui;
        for (const l of this.snapshotListeners) l();
        for (const l of this.uiListeners) l();
        return;
      case "ui":
        this.ui = message.ui;
        for (const l of this.uiListeners) l();
        return;
    }
  }
}
