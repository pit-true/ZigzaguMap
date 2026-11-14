/** ワープの右クリックの「行き先のマップを作る」（#241）の文言（ZigzaguMap 独自）。 */
export const jaWarpMap = {
  menu: "行き先のマップを作る",
  searching: "見本（同じタイルセットで同じブロックに乗っているワープの行き先）を探しています…",
  title: "行き先のマップを作る",
  intro: (n: number) =>
    n > 0
      ? `同じタイルセットで同じブロックに乗っているほかのワープの行き先が ${n} 枚あります。見本を選んでください（タイルセット・大きさ・ヘッダー・境界を写します）。`
      : "見本（同じタイルセットで同じブロックに乗っているほかのワープの行き先）はありません。9×9 で、今のマップのタイルセットで作ります。",
  sample: (bank: number, map: number, name: string | null, w: number, h: number) => `${bank}.${map}${name ? " " + name : ""}（${w}×${h}）`,
  noSample: "見本を使わない（9×9、今のマップのタイルセット、ブロック 0）",
  copyLayout: "見本の配置をそのまま写す（外すとブロック 0 で埋める）",
  created: (bank: number, map: number, w: number, h: number) =>
    `行き先のマップ ${bank}.${map}（${w}×${h}）を作り、ワープを向け合いました（1 回の「元に戻す」で全部戻ります）`,
  noWarp: "ワープがありません",
} as const;
