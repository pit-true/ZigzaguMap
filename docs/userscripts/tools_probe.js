// 確認用（tests/automation/user_script_check.py が使う）: 塗りつぶし・マジック塗り・シフトとコールバックを確かめる。
let hovers = 0;
let shifted = null;
zz.on("hoverChanged", (e) => {
  if (e.x !== null) hovers++;
});
zz.on("mapShifted", (e) => {
  shifted = e;
});
zz.registerAction("fill", "塗りつぶし", async () => {
  const n = await zz.map.fill(0, 0, 0x001);
  const m = await zz.map.fill(0, 0, 0x002, { magic: true });
  zz.log(`fill: flood=${n} magic=${m}`);
});
zz.registerAction("shift", "シフト", async () => {
  await zz.map.shift(1, 0);
});
zz.registerAction("report", "報告", () => {
  zz.log(`report: hovers=${hovers} shifted=${JSON.stringify(shifted)}`);
});
