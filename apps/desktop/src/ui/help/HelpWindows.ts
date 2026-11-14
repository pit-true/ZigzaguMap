import { getVersion } from "@tauri-apps/api/app";
import license from "../../../../../LICENSE?raw";
import readme from "../../../../../README.md?raw";
import { ja } from "../../i18n/ja";
import { createDialog, dialogButton, type DialogFrame } from "../Dialog";
import { openExternal } from "../../util/externalLinks";

/**
 * ヘルプの窓（ZigzaguMapについて、エンドユーザー規約、Read me）。
 * このモジュールはメニューで初めて開いたときに読み込む（README と LICENSE の本文を含むため）。
 */

/** OK だけの窓を出し、閉じるまで待つ。 */
function okWindow(title: string, className: string, build: (frame: DialogFrame) => void): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      frame.remove();
      resolve();
    };
    const frame = createDialog({ title, className, onClose: finish });
    build(frame);
    const bar = document.createElement("div");
    bar.className = "help-buttons";
    const ok = dialogButton(ja.ok, finish);
    bar.append(ok);
    frame.body.append(bar);
    frame.box.tabIndex = -1;
    frame.box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "Enter") finish();
    });
    frame.register({ title, text: frame.body.textContent ?? "", buttons: [ja.ok], press: () => finish() });
    ok.focus();
  });
}

/** ヘルプ > ZigzaguMapについて（F1）。アプリ名、バージョン、GitHub のリポジトリへのリンク（既定のブラウザで開く）だけを出す。 */
export async function openAbout(): Promise<void> {
  const version = await getVersion().catch(() => "0.0.0");
  const h = ja.help;
  await okWindow(h.aboutTitle, "about-window", (frame) => {
    const name = document.createElement("div");
    name.className = "about-name";
    name.textContent = ja.appTitle;
    const ver = document.createElement("div");
    ver.className = "about-version";
    ver.dataset["autoId"] = "about.version";
    ver.textContent = h.version(version);
    const link = document.createElement("a");
    link.className = "about-link";
    link.href = h.repositoryUrl;
    link.textContent = h.repositoryUrl;
    link.dataset["autoId"] = "about.link";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      void openExternal(h.repositoryUrl);
    });
    frame.body.append(name, ver, link);
  });
}

/** ヘルプ > エンドユーザー規約（F2）。ZigzaguMap のライセンス（MIT）を読み取り専用で出す。 */
export function openEula(): Promise<void> {
  return okWindow(ja.eula, "eula-window", (frame) => frame.body.append(memo(license)));
}

/** ヘルプ > Read me。README.md の本文を出す。 */
export function openReadme(): Promise<void> {
  return okWindow(ja.readMe, "readme-window", (frame) => frame.body.append(memo(readme)));
}

function memo(text: string): HTMLElement {
  const area = document.createElement("textarea");
  area.className = "help-memo";
  area.readOnly = true;
  area.value = text.replace(/\r\n/g, "\n");
  return area;
}
