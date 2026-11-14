import "./styles/all";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { peekStartupSettings, startStartupPrefetch } from "./app/startupPrefetch";
import { timings } from "./app/timings";

async function main(): Promise<void> {
  timings.mark("scriptStart");
  const root = document.getElementById("app");
  if (!root) return;
  // 道具のウィンドウは tool.html（tool.ts）から開く。ここに来るのは古い作り方で開いたときだけ。
  const label = getCurrentWebviewWindow().label;
  if (label !== "main") {
    const { startToolWindow } = await import("./windows/startToolWindow");
    await startToolWindow(label, root);
    return;
  }
  // 起動引数の ROM を先に読み始め、その間に画面のコードを読み込んで組み立てる（Phase4 #318）
  startStartupPrefetch();
  const [{ App }, { Settings }] = await Promise.all([import("./app/App"), import("./app/Settings")]);
  timings.mark("appLoaded");
  // 個人設定も先に読み始めたものを使う（App.start で起動引数と ROM を受け取る）
  const settings = await Settings.load(peekStartupSettings());
  timings.mark("settingsLoaded");
  const app = new App(root, settings);
  timings.mark("domReady");
  await app.start();
}

void main();
