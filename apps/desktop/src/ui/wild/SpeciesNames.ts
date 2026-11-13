import type { ProjectSession } from "../../app/ProjectSession";
import { ja } from "../../i18n/ja";

/**
 * 種族名を引く入口。ROM の種族名表の読み取り（core の name/）が使えるセッションならそれを、
 * 使えなければ番号の表示に戻る。セッションが `speciesNames`（`name(番号)` を持つもの）を持っていれば使う。
 */
export interface SpeciesNameProvider {
  /** 種族名。読めなければ null。 */
  name(species: number): string | null;
}

/** 素の FR の種族の数（0 番を含む。AdvanceMap の種族のコンボは 0〜411 の 412 件）。 */
export const FR_SPECIES_COUNT = 412;

/** セッションの種族名の入口（無ければ null）。 */
export function speciesNameProvider(session: ProjectSession | null): SpeciesNameProvider | null {
  const provider = (session as unknown as { speciesNames?: SpeciesNameProvider | null } | null)?.speciesNames;
  return provider && typeof provider.name === "function" ? provider : null;
}

/** 種族のコンボの表記（0 番は「選択してください」、名前が読めなければ番号）。 */
export function speciesLabel(provider: SpeciesNameProvider | null, species: number): string {
  if (species === 0) return ja.wild.chooseSpecies;
  return provider?.name(species) ?? ja.wild.speciesNumber(species);
}

/**
 * 種族のコンボの選択肢（`count` 件）をまとめて作る（12 個のコンボで使い回すため、1 回作って複製する）。
 */
export class SpeciesOptions {
  private template: HTMLSelectElement | null = null;
  private key = "";

  constructor(private readonly session: () => ProjectSession | null) {}

  /** `count` 件の選択肢を入れたコンボの元。 */
  options(count: number): HTMLSelectElement {
    const provider = speciesNameProvider(this.session());
    const key = `${count}:${provider ? "names" : "numbers"}:${String(this.session()?.romPath)}`;
    if (!this.template || this.key !== key) {
      const select = document.createElement("select");
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < count; i++) fragment.append(new Option(speciesLabel(provider, i)));
      select.append(fragment);
      select.dataset["key"] = key;
      this.template = select;
      this.key = key;
    }
    return this.template;
  }
}
