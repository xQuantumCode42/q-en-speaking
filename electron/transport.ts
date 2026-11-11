import { z } from "zod";
import { abortable } from "./abort";
import type { TalkPhase } from "../shared/api";
export function subscriptionError(
  status: number,
  body: unknown,
  requestId?: string | null,
): Error {
  const parsed = z
    .object({
      error: z.object({ code: z.string().optional() }).optional(),
      response: z
        .object({ error: z.object({ code: z.string().optional() }).optional() })
        .optional(),
      code: z.string().optional(),
    })
    .safeParse(body);
  const code = parsed.success
    ? (parsed.data.error?.code ??
      parsed.data.response?.error?.code ??
      parsed.data.code ??
      "")
    : "";
  const messages: Record<string, string> = {
    subscription_sharing_user_not_eligible:
      "此 ChatGPT 帳戶、工作區或政策尚未開放訂閱使用授權。",
    subscription_sharing_usage_limit_exceeded:
      "已達 ChatGPT 訂閱或本 App 的用量上限，請到設定開啟用量管理。",
    subscription_sharing_usage_unavailable:
      "暫時無法確認 ChatGPT 訂閱用量，請稍後重試。",
    subscription_sharing_unsupported_capability:
      "所選模型不支援這項回覆要求，請選擇其他可用模型。",
    subscription_sharing_invalid_user: "ChatGPT 登入驗證失敗，請重新登入。",
    chatpass_v2_scope_not_authorized:
      "尚未允許本 App 使用 ChatGPT 訂閱，請到設定啟用。",
  };
  const message =
    messages[code] ??
    (status === 401
      ? "ChatGPT 登入或訂閱授權已失效，請重新登入。"
      : status === 403
        ? "ChatGPT 訂閱授權或服務地區限制阻止此請求，請到設定確認帳戶。"
        : status === 429
          ? "ChatGPT 用量已達上限或請求過於頻繁，請查看訂閱用量後重試。"
          : `AI 服務暫時無法完成回覆（HTTP ${status}），請稍後重試。`);
  const diagnostic = /^[a-zA-Z0-9_-]{1,100}$/.test(code) ? ` [${code}]` : "";
  const request =
    requestId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId)
      ? ` 請求編號 ${requestId}`
      : "";
  return new Error(message + diagnostic + request);
}

// Buffer complete SSE frames, including UTF-8 characters split across network chunks.
// Partial deltas are never returned as a successful result.
export async function readResponsesStream(
  response: Response,
  signal?: AbortSignal,
  onProgress?: (phase: TalkPhase, characters: number) => void,
): Promise<string> {
  if (!response.body) throw new Error("AI 沒有回傳串流內容，請重試。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let characters = 0;
  const consume = (frame: string): string | undefined => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error("AI 串流格式不正確，尚未保存，請重試。");
    }
    const event = z
      .object({
        type: z.string(),
        response: z.unknown().optional(),
        delta: z.string().optional(),
        item: z.object({ type: z.string() }).optional(),
      })
      .parse(value);
    if (
      event.type === "response.output_item.added" &&
      event.item?.type === "reasoning"
    )
      onProgress?.("reasoning", characters);
    if (event.type === "response.output_text.delta") {
      characters += event.delta?.length ?? 0;
      onProgress?.("generating", characters);
    }
    if (event.type === "error" || event.type === "response.failed")
      throw subscriptionError(503, value, response.headers.get("x-request-id"));
    if (event.type === "response.incomplete")
      throw new Error("AI 未完成回應，請縮短文章後重試。");
    if (event.type !== "response.completed") return;
    const completed = z
      .object({
        status: z.literal("completed"),
        output: z.array(
          z.object({
            content: z
              .array(
                z.object({ type: z.string(), text: z.string().optional() }),
              )
              .optional(),
          }),
        ),
      })
      .safeParse(event.response);
    if (!completed.success)
      throw new Error("AI 完成事件格式不正確，尚未保存。");
    return completed.data.output
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("");
  };
  try {
    while (true) {
      const { done, value } = await (signal
        ? abortable(reader.read(), signal)
        : reader.read());
      if (value) {
        total += value.byteLength;
        if (total > 4 * 1024 * 1024)
          throw new Error("AI 回應過大，尚未保存，請縮短文章後重試。");
      }
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const output = consume(frame);
        if (output !== undefined) return output;
      }
      if (done) {
        if (buffer.trim()) {
          const output = consume(buffer);
          if (output !== undefined) return output;
        }
        throw new Error("AI 串流中斷，尚未完成回覆，請重試。");
      }
    }
  } finally {
    // Cleanup must never delay completion, timeout, or the user's Cancel action.
    void reader.cancel().then(
      () => {
        try {
          reader.releaseLock();
        } catch {}
      },
      () => {},
    );
  }
}
