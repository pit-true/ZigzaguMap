/**
 * 入力欄の「打ちかけ」（利用者が入力してから、Enter・Esc・フォーカスを外すまで）を覚える。
 * 外からの変更（元に戻す・F2・取り込みなど）で欄を書き換えるときに、打ちかけの文字を消さないために使う。
 * フォーカスがあるだけでは打ちかけにしない（Enter で決めたあとも欄にフォーカスは残る）。
 */
const typing = new WeakSet<HTMLInputElement>();

/** 欄の入力を見張る（作るときに 1 回呼ぶ）。 */
export function watchTyping(input: HTMLInputElement): void {
  input.addEventListener("input", () => typing.add(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") typing.delete(input);
  });
  input.addEventListener("blur", () => typing.delete(input));
}

/** 打ちかけの文字があるか（フォーカスがあり、入力してからまだ決めていない）。 */
export function isTyping(input: HTMLInputElement): boolean {
  return typing.has(input) && document.activeElement === input;
}
