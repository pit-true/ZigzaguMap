import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PendingReplies } from "../../util/pendingReplies";
import { MAP_ASSIST_MESSAGE_EVENT, MAP_ASSIST_REQUEST_EVENT, type AssistData, type AssistMessage, type AssistRange, type AssistRequest } from "./protocol";

/** 要求の中身（番号は MapAssistClient が付ける）。 */
export type AssistRequestBody = AssistRequest extends infer R ? (R extends AssistRequest ? Omit<R, "id"> : never) : never;

/** メインから届く知らせの受け手。 */
export interface MapAssistClientListener {
  /** 今のマップの組のこと（タイルセット・パーツが変わったとき）。 */
  data(data: AssistData): void;
  /** メインで選んでいる範囲が変わったとき。 */
  range(range: AssistRange | null): void;
}

/**
 * マップ作成補助のウィンドウからメインウィンドウへの窓口（ワールドマップの WorldMapClient と同じ形）。
 * 要求を送って返事を待ち、メインからの知らせを受け手へ渡す。
 */
export class MapAssistClient {
  private readonly pending = new PendingReplies();

  /** 購読を始める。 */
  async connect(listener: MapAssistClientListener): Promise<void> {
    await getCurrentWebviewWindow().listen<AssistMessage>(MAP_ASSIST_MESSAGE_EVENT, (e) => {
      const m = e.payload;
      if (m.type === "reply") this.pending.settle(m);
      else if (m.type === "data") listener.data(m.data);
      else listener.range(m.range);
    });
  }

  /** メインへ要求を送り、返事を待つ（失敗なら Error）。 */
  request(body: AssistRequestBody): Promise<unknown> {
    const { id, reply, fail } = this.pending.open();
    emitTo("main", MAP_ASSIST_REQUEST_EVENT, { ...body, id }).catch(fail);
    return reply;
  }
}
