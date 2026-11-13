import type { App } from "../App";

/** 自動操作の要求（JSON 1 件）。 */
export type AutomationRequest = Record<string, unknown>;

/** 命令の処理。返した値が返事の `result` になる。 */
export type CommandHandler = (app: App, req: AutomationRequest) => unknown;

/** 分野ごとのファイルが登録する命令の表（命令名 → 処理）。 */
export type CommandTable = Readonly<Record<string, CommandHandler>>;

/**
 * 命令の登録表。分野ごとのファイル（core・fields・mouse・dialogs・menu・tree・images・status・events）の表を 1 つにまとめる。
 * 同じ名前を 2 か所で登録したら起動時に Error にする（取り違えを防ぐ）。
 */
export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(tables: readonly CommandTable[]) {
    for (const table of tables) {
      for (const [name, handler] of Object.entries(table)) {
        if (this.handlers.has(name)) throw new Error(`自動操作の命令が重複しています: ${name}`);
        this.handlers.set(name, handler);
      }
    }
  }

  /** 命令の処理（無ければ undefined）。 */
  get(name: string): CommandHandler | undefined {
    return this.handlers.get(name);
  }

  /** 登録されている命令の名前（`commands` 命令の返事）。 */
  names(): string[] {
    return [...this.handlers.keys()].sort();
  }
}

// ---- 引数の読み取り

export function str(req: AutomationRequest, key: string): string {
  const v = req[key];
  if (typeof v !== "string") throw new Error(`${key} は文字列で指定してください`);
  return v;
}

export function optStr(req: AutomationRequest, key: string): string | null {
  const v = req[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`${key} は文字列で指定してください`);
  return v;
}

export function int(req: AutomationRequest, key: string): number {
  const v = req[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${key} は整数で指定してください`);
  return v;
}

export function num(req: AutomationRequest, key: string): number {
  const v = req[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} は数で指定してください`);
  return v;
}

/** 押したあとの処理（次のダイアログを出すなど）が進むのを少し待つ。 */
export function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 描画を 2 回待つ（描画が止まっていても 300ms で諦める）。 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 300);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}
