// 自動操作の入口へ JSON を 1 件送り、返事を表示する（テスト用）。
// 使い方: node scripts/automation-client.mjs <ポート> '<JSON>' [PNG の保存先]
//   例: node scripts/automation-client.mjs 17890 '{"cmd":"state"}'
//       node scripts/automation-client.mjs 17890 '{"cmd":"screenshot"}' shot.png
import { writeFileSync } from "node:fs";

const [port, body, out] = process.argv.slice(2);
if (!port || !body) {
  console.error("使い方: node scripts/automation-client.mjs <ポート> '<JSON>' [PNG の保存先]");
  process.exit(2);
}
const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body });
const reply = await res.json();
const png = reply?.result?.png;
if (out && typeof png === "string") {
  writeFileSync(out, Buffer.from(png, "base64"));
  reply.result.png = `(${out} に保存)`;
}
console.log(JSON.stringify(reply, null, 2));
process.exit(reply.ok ? 0 : 1);
