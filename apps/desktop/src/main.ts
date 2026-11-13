import "./styles/all";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { App } from "./app/App";
import { Settings } from "./app/Settings";
import { timings } from "./app/timings";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  // 道具のウィンドウは tool.html（tool.ts）から開く。ここに来るのは古い作り方で開いたときだけ。
  const label = getCurrentWebviewWindow().label;
  if (label !== "main") {
    const { startToolWindow } = await import("./windows/world-map/startToolWindow");
    await startToolWindow(label, root);
    return;
  }
  const settings = await Settings.load();
  const app = new App(root, settings);
  timings.mark("domReady");
  await app.start();
}

void main();
