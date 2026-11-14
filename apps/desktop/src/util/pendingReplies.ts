import { errorText } from "./errors";

/** 返事（成功なら `result`、失敗なら `error`）。ウィンドウの間のやり取りで同じ形を使う。 */
export type Reply = { readonly id: number; readonly ok: true; readonly result: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

/** 届いた返事の形（ブロックエディタ・マップ作成補助の返事は `ok` が boolean で、`error` を省くことがある）。 */
export interface ReplyLike {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/** 返事を待つ 1 件。 */
export interface PendingReply {
  readonly id: number;
  /** 返事が届いたら決まる（失敗なら Error）。 */
  readonly reply: Promise<unknown>;
  /** 送れなかったときに呼ぶ（待つのをやめて失敗にする）。 */
  fail(e: unknown): void;
}

/**
 * 別のウィンドウへ送った要求の返事を待つ台帳（番号を振り、同じ番号の返事で約束を決める）。
 * 別ウィンドウ（スクリプトエディタ・ワールドマップ・マップ作成補助・ブロックエディタなど）とメインの両側で使う。
 */
export class PendingReplies {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  /** 新しい番号で待ち始める。`timeout` を渡すと、その時間を過ぎたら `timeout.error()` で失敗にする。 */
  open(timeout?: { readonly ms: number; readonly error: () => Error }): PendingReply {
    const id = this.nextId++;
    let fail!: (e: unknown) => void;
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.waiting.delete(id);
            reject(timeout.error());
          }, timeout.ms)
        : undefined;
      const done = (fn: () => void): void => {
        clearTimeout(timer);
        fn();
      };
      this.waiting.set(id, { resolve: (v) => done(() => resolve(v)), reject: (e) => done(() => reject(e)) });
      fail = (e) => {
        this.waiting.delete(id);
        done(() => reject(e instanceof Error ? e : new Error(String(e))));
      };
    });
    return { id, reply, fail };
  }

  /** 返事を待っている数。 */
  get size(): number {
    return this.waiting.size;
  }

  /** 返事が届いた（知らない番号なら何もしない）。失敗の返事に文言が無ければ `fallbackError` を使う。 */
  settle(reply: ReplyLike, fallbackError = ""): void {
    const w = this.waiting.get(reply.id);
    if (!w) return;
    this.waiting.delete(reply.id);
    if (reply.ok) w.resolve(reply.result);
    else w.reject(new Error(reply.error ?? fallbackError));
  }

  /** 待っているものを全部失敗にする（相手のウィンドウが閉じたとき）。 */
  rejectAll(error: Error): void {
    for (const w of this.waiting.values()) w.reject(error);
    this.waiting.clear();
  }
}

/** 処理を動かして返事を作る（戻り値が undefined なら null。投げたら失敗の返事）。 */
export async function replyOf(id: number, run: () => unknown): Promise<Reply> {
  try {
    return { id, ok: true, result: (await run()) ?? null };
  } catch (e) {
    return { id, ok: false, error: errorText(e) };
  }
}
