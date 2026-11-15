// 例: 草むらのブロックを置いたら、そのマスの移動許可を「通れる（0C）」にそろえる（ZigzaguMap のスクリプトの例。Phase5 #405）。
// プロジェクトフォルダの zigzagumap-scripts\ に置き、設定 > スクリプトの管理... でチェックすると動く。
// 置いた操作とこのスクリプトの変更は別の操作になる（Ctrl+Z 1 回でこのスクリプトの変更だけ戻る）。

const GRASS = 0x00d; // FR の主タイルセットの草むら
const WALKABLE = 0x0c;

zz.on("blocksChanged", async (e) => {
  if (e.kind !== "execute") return; // 戻る・進むでは何もしない
  const current = await zz.map.current();
  if (!current || current.bank !== e.bank || current.map !== e.map) return;
  let changed = 0;
  for (const { x, y } of e.cells) {
    if ((await zz.map.getBlock(x, y)) !== GRASS) continue;
    if ((await zz.map.getMovement(x, y)) === WALKABLE) continue;
    await zz.map.setMovement(x, y, WALKABLE);
    changed++;
  }
  if (changed > 0) zz.log(`草むら ${changed} マスの移動許可を 0C にしました`);
});
