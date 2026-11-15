// 例: ツール > スクリプトの操作「全マップのブロックを数える」（ZigzaguMap のスクリプトの例。Phase5 #405）。
// 聞いたブロック番号が、プロジェクトの全マップに何マスあるかを数えてステータスバーとログに出す。

zz.registerAction("countBlocks", "全マップのブロックを数える", async () => {
  const answer = await zz.ui.input("数えるブロック番号（16 進）", "00D");
  if (answer === null) return;
  const block = parseInt(answer, 16);
  if (Number.isNaN(block)) {
    await zz.ui.message(`16 進の数ではありません: ${answer}`);
    return;
  }
  let total = 0;
  let maps = 0;
  for (const m of await zz.maps.list()) {
    const cells = await zz.maps.getCells(m.bank, m.map);
    const n = cells.blocks.filter((b) => b === block).length;
    if (n > 0) maps++;
    total += n;
  }
  const text = `ブロック ${block.toString(16).toUpperCase().padStart(3, "0")} は ${maps} 枚のマップに ${total} マスあります`;
  zz.log(text);
  await zz.ui.status(text);
});
