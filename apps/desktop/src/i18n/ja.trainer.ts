/** トレーナー（#244・#245）の文言（ZigzaguMap 独自）。 */
export const jaTrainer = {
  choice: (id: number, className: string, name: string, party: number, uses: number, edited: boolean) =>
    `0x${id.toString(16).toUpperCase()} ${className} ${name}（手持ち ${party}）${edited ? " ＊trainers.json" : ""}${uses > 0 ? ` 使用中 ${uses}` : ""}`,
  newTrainer: "新しいトレーナーを作る（maps\\trainers.json に書く）",
  id: "番号",
  name: "名前（5 文字まで）",
  trainerClass: "クラス",
  pic: "絵",
  music: "BGM",
  female: "女性",
  party: "手持ち（種族 レベル をカンマで区切る）",
  seed: "乱数の種",
  generate: "自動で作る",
  generated: (maps: string, n: number) => (n > 0 ? `${maps} の野生から作りました` : "このマップと隣・ワープの先に野生がいません。種族とレベルを入れてください"),
  partyHint: "例: 0x10 9, 0x13 8",
  badParty: (text: string) => `手持ちが読めません: ${text}（「種族 レベル」をカンマで区切って 1〜6 匹）`,
  defaultName: "タロウ",
};
