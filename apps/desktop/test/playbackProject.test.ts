import { expect, it } from "vitest";
import { MemoryProjectFs } from "@zigzagumap/core";
import type { App } from "../src/app/App";
import { PlaybackProjectData } from "../src/ui/playback/PlaybackProject";

async function fixture() {
  const fs = new MemoryProjectFs();
  await fs.writeText("xse_commands.s", ".macro end\n.byte 2\n.endm\n");
  await fs.writeText("assembly/overworld_scripts/a.s", "Saved:\nend\n");
  await fs.writeText("strings/a.string", "#org @Message\n保存した文\n");
  const edited = new Map([["assembly/overworld_scripts/a.s", "Editing:\nend\n"], ["strings/a.string", "#org @Message\n編集中の文\\n次の行\n"]]);
  const state = { session: { projectDir: "fixture", files: fs }, map: {} };
  const app = { state, scripts: { files: { read: async (path: string) => ({ text: edited.get(path) ?? await fs.readText(path) }) } } } as unknown as App;
  return { app, fs, state };
}

it("エディタの未保存の本文で索引と文を作り、保存済みのファイルを保つ", async () => {
  const { app, fs } = await fixture();
  const before = [...fs.files];
  const data = await PlaybackProjectData.load(app);
  expect(data.project.index.findLabel("Editing")?.path).toBe("assembly/overworld_scripts/a.s");
  expect(data.project.index.findLabel("Saved")).toBeUndefined();
  expect(data.project.text("missing.s")).toBeNull();
  expect(data.messages.get("Message")).toBe("編集中の文\\n次の行");
  expect([...fs.files]).toEqual(before);
});

it("読み込み中に対象が変わると結果を採用しない", async () => {
  const { app, state } = await fixture();
  const reading = PlaybackProjectData.load(app);
  state.map = {};
  await expect(reading).rejects.toThrow("マップが切り替わりました");
});
