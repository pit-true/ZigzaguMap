// 確認用（tests/automation/user_script_check.py が使う）: ファイルや外部とのやり取りに使える関数が無いことを確かめる。
zz.registerAction("probe", "使えない関数を確かめる", async () => {
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "indexedDB", "caches", "Worker", "EventSource"];
  const usable = names.filter((n) => typeof globalThis[n] !== "undefined" && globalThis[n] !== null);
  const tauri = typeof globalThis.__TAURI_INTERNALS__ !== "undefined" || typeof globalThis.__TAURI__ !== "undefined";
  zz.log(`probe: usable=${JSON.stringify(usable)} tauri=${tauri}`);
});
