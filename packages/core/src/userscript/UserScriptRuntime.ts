import {
  USER_SCRIPT_EVENTS,
  type HostToWorker,
  type UserScriptEvent,
  type UserScriptMethod,
  type WorkerToHost,
} from "./UserScriptProtocol.js";

type Handler = (payload: unknown) => unknown;

/** スクリプトに渡す `zz`（Porymap の名前に寄せた ZigzaguMap の API）。どの関数も Promise を返す。 */
export interface UserScriptApi {
  readonly map: {
    current(): Promise<unknown>;
    getBlock(x: number, y: number): Promise<number>;
    setBlock(x: number, y: number, block: number): Promise<void>;
    getMovement(x: number, y: number): Promise<number>;
    setMovement(x: number, y: number, movement: number): Promise<void>;
    getCells(): Promise<unknown>;
    getBorder(x: number, y: number): Promise<number>;
    setBorder(x: number, y: number, block: number): Promise<void>;
    getHeader(): Promise<unknown>;
    getTilesets(): Promise<unknown>;
    /** 塗りつぶし（`magic` でマジック塗り、`movement` で移動許可を塗る）。塗ったマスの数を返す。 */
    fill(x: number, y: number, value: number, options?: { magic?: boolean; movement?: boolean }): Promise<number>;
    /** マップシフト（はみ出た分は反対側へ回る）。 */
    shift(dx: number, dy: number): Promise<void>;
  };
  readonly maps: { list(): Promise<unknown>; getCells(bank: number, map: number): Promise<unknown> };
  readonly names: { list(kind: string): Promise<unknown> };
  readonly ui: {
    message(text: string): Promise<void>;
    input(prompt: string, initial?: string): Promise<string | null>;
    status(text: string): Promise<void>;
  };
  readonly view: { setGrid(show: boolean): Promise<void> };
  /** コールバックを登録する（`projectOpened`・`mapOpened`・`blocksChanged` など）。 */
  on(event: UserScriptEvent, handler: Handler): void;
  /** ツール > スクリプトの操作を登録する（スクリプトの管理の窓から動かせる）。 */
  registerAction(id: string, label: string, run: () => unknown): Promise<void>;
  log(...values: unknown[]): void;
}

/** 文字にする（ログ用）。 */
function text(values: readonly unknown[]): string {
  return values
    .map((v) => {
      if (typeof v === "string") return v;
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    })
    .join(" ");
}

/**
 * Worker の中で動く側（Phase5 #405）。ホストからのメッセージを受け、スクリプトを読み込み、コールバックと操作を 1 つずつ順に動かす。
 * API の呼び出しはメッセージにしてホストへ送り、返事を待つ。1 回の呼び出しの前後に `begin`・`end` を送る
 * （ホストはそのあいだの書き込みを 1 回の「元に戻す」にまとめる）。`post` はホストへ送る関数、`evaluate` はスクリプトを動かす関数。
 */
export class UserScriptRuntime {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly handlers = new Map<UserScriptEvent, Handler[]>();
  private readonly actions = new Map<string, () => unknown>();
  private queue: Promise<void> = Promise.resolve();
  readonly api: UserScriptApi;

  constructor(
    private readonly post: (message: WorkerToHost) => void,
    private readonly evaluate: (code: string, api: UserScriptApi, name: string) => void,
  ) {
    const call =
      <T>(method: UserScriptMethod) =>
      (...args: unknown[]): Promise<T> =>
        this.call(method, args) as Promise<T>;
    this.api = {
      map: {
        current: call("map.current"),
        getBlock: call("map.getBlock"),
        setBlock: call("map.setBlock"),
        getMovement: call("map.getMovement"),
        setMovement: call("map.setMovement"),
        getCells: call("map.getCells"),
        getBorder: call("map.getBorder"),
        setBorder: call("map.setBorder"),
        getHeader: call("map.getHeader"),
        getTilesets: call("map.getTilesets"),
        fill: call("map.fill"),
        shift: call("map.shift"),
      },
      maps: { list: call("maps.list"), getCells: call("maps.getCells") },
      names: { list: call("names.list") },
      ui: { message: call("ui.message"), input: call("ui.input"), status: call("ui.status") },
      view: { setGrid: call("view.setGrid") },
      on: (event, handler) => {
        if (!(USER_SCRIPT_EVENTS as readonly string[]).includes(event)) throw new Error(`知らないコールバックです: ${event}`);
        if (typeof handler !== "function") throw new Error("コールバックが関数ではありません");
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
      },
      registerAction: (id, label, run) => {
        if (typeof run !== "function") throw new Error("操作が関数ではありません");
        this.actions.set(String(id), run);
        return this.call("ui.registerAction", [String(id), String(label)]) as Promise<void>;
      },
      log: (...values) => this.post({ type: "log", level: "log", text: text(values) }),
    };
  }

  /** ホストからのメッセージ。 */
  receive(message: HostToWorker): void {
    switch (message.type) {
      case "reply": {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id);
        if (message.ok) p.resolve(message.value);
        else p.reject(new Error(message.error ?? "エラー"));
        return;
      }
      case "load":
        this.enqueue(`load:${message.name}`, () => {
          try {
            this.evaluate(message.code, this.api, message.name);
            this.post({ type: "loaded", name: message.name });
          } catch (e) {
            this.post({ type: "loaded", name: message.name, error: errorText(e) });
          }
        });
        return;
      case "event":
        for (const handler of this.handlers.get(message.event) ?? []) this.enqueue(message.event, () => handler(message.payload));
        return;
      case "action": {
        const run = this.actions.get(message.id);
        if (run) this.enqueue(`action:${message.id}`, run);
        else this.post({ type: "log", level: "error", text: `登録されていない操作です: ${message.id}` });
      }
    }
  }

  /** 1 つずつ順に動かす（前の呼び出しが終わってから次）。 */
  private enqueue(label: string, run: () => unknown): void {
    this.queue = this.queue.then(async () => {
      this.post({ type: "begin", label });
      try {
        await run();
        this.post({ type: "end" });
      } catch (e) {
        const error = errorText(e);
        this.post({ type: "log", level: "error", text: `${label}: ${error}` });
        this.post({ type: "end", error });
      }
    });
  }

  private call(method: UserScriptMethod, args: readonly unknown[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "call", id, method, args });
    });
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
