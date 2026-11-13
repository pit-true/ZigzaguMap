import "./styles/base.css";
import "./styles/menu.css";
import "./styles/toolbar.css";
import "./styles/tree.css";
import "./styles/tabs.css";
import "./styles/map.css";
import "./styles/forms.css";
import "./styles/statusbar.css";
import "./styles/dialog.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { App } from "./app/App";
import { Settings } from "./app/Settings";
import { timings } from "./app/timings";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  // 道具のウィンドウ（ラベルが main 以外）は、そのウィンドウの中身だけを組み立てる。
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
