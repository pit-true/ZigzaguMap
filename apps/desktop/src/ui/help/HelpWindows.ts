import { getVersion } from "@tauri-apps/api/app";
import license from "../../../../../LICENSE?raw";
import readme from "../../../../../README.md?raw";
import { ja } from "../../i18n/ja";
import { createDialog, dialogButton, type DialogFrame } from "../Dialog";
import { ICONS } from "../icons";

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

/** ヘルプ > ZigzaguMapについて（F1）。AdvanceMap の About と同じ並び（黒い帯の見出し、クレジット、バージョン）。 */
export async function openAbout(): Promise<void> {
  const version = await getVersion().catch(() => "0.0.0");
  const h = ja.help;
  await okWindow(h.aboutTitle, "about-window", (frame) => {
    const band = document.createElement("div");
    band.className = "about-band";
    const icon = document.createElement("span");
    icon.className = "about-icon";
    icon.innerHTML = ICONS["showObjects"] ?? "";
    const name = document.createElement("span");
    name.textContent = ja.appTitle;
    band.append(icon, name);

    const credits = document.createElement("fieldset");
    credits.className = "group-box about-credits";
    const legend = document.createElement("legend");
    legend.textContent = h.credits;
    credits.append(legend);
    for (const [heading, rows] of h.sections) {
      const head = document.createElement("div");
      head.className = "about-heading";
      head.textContent = heading;
      const table = document.createElement("div");
      table.className = "about-table";
      for (const [label, value] of rows) {
        const l = document.createElement("span");
        l.textContent = label;
        const v = document.createElement("span");
        v.textContent = value;
        if (/^https?:/.test(value)) v.className = "about-link";
        table.append(l, v);
      }
      credits.append(head, table);
    }

    const foot = document.createElement("div");
    foot.className = "about-foot";
    const left = document.createElement("div");
    left.textContent = h.version(version);
    const right = document.createElement("div");
    right.textContent = h.license;
    foot.append(left, right);
    const copy = document.createElement("div");
    copy.className = "about-copy";
    copy.textContent = h.copyright;
    frame.body.append(band, credits, foot, copy);
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
