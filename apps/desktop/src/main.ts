import "./styles/base.css";
import "./styles/menu.css";
import "./styles/toolbar.css";
import "./styles/tree.css";
import "./styles/tabs.css";
import "./styles/map.css";
import "./styles/forms.css";
import "./styles/statusbar.css";
import "./styles/dialog.css";
import "./styles/amform.css";
import { App } from "./app/App";
import { Settings } from "./app/Settings";
import { timings } from "./app/timings";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  const settings = await Settings.load();
  const app = new App(root, settings);
  timings.mark("domReady");
  await app.start();
}

void main();
