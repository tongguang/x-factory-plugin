import { saveBase64Image, saveImageFromUrl } from "./save.js";
import type { PluginConfig } from "./config.js";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface ImageItem {
  b64_json?: string;
  url?: string;
}

export interface ImagesResponse {
  data?: ImageItem[];
}

function describeHttpError(status: number, body: string): string {
  const short = body.replace(/\s+/g, " ").slice(0, 300);
  if (status === 401 || status === 403) {
    return `认证失败（HTTP ${status}）。请检查 config.json 中的 apiKey。`;
  }
  if (status === 429) {
    return "服务限流（HTTP 429）。本次未重发请求以避免重复计费。";
  }
  if (status === 404) {
    return "服务返回 HTTP 404。请检查 baseUrl、Images API 路径和模型名称。";
  }
  return `生图服务返回 HTTP ${status}${short ? `：${short}` : ""}`;
}

async function post(
  config: PluginConfig,
  endpoint: string,
  body: Record<string, unknown> | FormData
): Promise<ImagesResponse> {
  const multipart = body instanceof FormData;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${config.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(!multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err instanceof Error && err.name === "TimeoutError") || /timed out|timeout/i.test(msg)) {
      throw new ApiError(
        `请求超时（>${Math.round(config.timeoutMs / 1000)} 秒）。结果未知，未自动重试以避免重复计费；可调大 config.json 的 timeoutMs。`
      );
    }
    throw new ApiError(`无法连接生图服务：${msg.replaceAll(config.apiKey, "[已隐藏]")}`);
  }
  if (!res.ok) {
    throw new ApiError(describeHttpError(res.status, text.replaceAll(config.apiKey, "[已隐藏]")), res.status);
  }
  try {
    return JSON.parse(text) ?? {};
  } catch {
    throw new ApiError("生图服务返回了无法解析的响应（非 JSON）。");
  }
}

export async function saveImageItem(outputDir: string, item: ImageItem, timeoutMs: number): Promise<string> {
  if (typeof item?.b64_json === "string" && item.b64_json.length > 0) {
    return saveBase64Image(outputDir, item.b64_json);
  }
  if (typeof item?.url === "string" && item.url.length > 0) {
    return saveImageFromUrl(outputDir, item.url, timeoutMs);
  }
  throw new ApiError("响应中的图片既没有 b64_json 也没有 url，无法保存。");
}

export interface GenerateParams {
  prompt: string;
  count: number;
  size?: string;
  transparent?: boolean;
}

export interface EditParams extends GenerateParams {
  image: { buffer: Buffer; filename: string; mime: string };
}

export async function requestGeneration(config: PluginConfig, params: GenerateParams): Promise<ImagesResponse> {
  return post(config, "/images/generations", {
    model: config.model, prompt: params.prompt, n: params.count,
    ...(params.size ? { size: params.size } : {}),
    output_format: "png",
    ...(params.transparent ? { background: "transparent" } : {}),
  });
}

export async function requestEdit(config: PluginConfig, params: EditParams): Promise<ImagesResponse> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(params.image.buffer)], { type: params.image.mime }), params.image.filename);
  form.append("model", config.model);
  form.append("prompt", params.prompt);
  form.append("n", String(params.count));
  if (params.size) form.append("size", params.size);
  form.append("output_format", "png");
  if (params.transparent) form.append("background", "transparent");
  return post(config, "/images/edits", form);
}
