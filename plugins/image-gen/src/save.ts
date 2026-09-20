import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** 单张图片下载、解码及保存的大小上限（字节）。 */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class SaveError extends Error {}

function checkSize(bytes: number): void {
  if (bytes > MAX_IMAGE_BYTES) throw new SaveError("图片超过 25 MiB 上限，已停止处理。");
}

/** 仅识别文件头，不进行完整图片解码。 */
function imageExtension(buf: Buffer): string {
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  const header = buf.toString("latin1", 0, 6);
  if (header === "GIF87a" || header === "GIF89a") return ".gif";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return ".webp";
  throw new SaveError("返回内容不是支持的图片格式，仅支持 PNG / JPEG / WebP / GIF。");
}

async function writeBuffer(outputDir: string, buf: Buffer): Promise<string> {
  if (buf.length === 0) throw new SaveError("图片内容为空。");
  checkSize(buf.length);
  const ext = imageExtension(buf);
  await mkdir(outputDir, { recursive: true });
  const full = path.join(outputDir, `img-${randomUUID()}${ext}`);
  await writeFile(full, buf, { flag: "wx" });
  return full;
}

/** 保存 Base64 图片，返回绝对路径 */
export async function saveBase64Image(
  outputDir: string,
  b64: string
): Promise<string> {
  const encoded = b64.replace(/\s/g, "");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  checkSize(Math.floor(encoded.length * 3 / 4) - padding);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new SaveError("Base64 图片数据无法解码。");
  }
  return writeBuffer(outputDir, Buffer.from(encoded, "base64"));
}

/**
 * 下载图片 URL 并保存，返回绝对路径。
 * 限制目标协议、大小与超时。
 */
export async function saveImageFromUrl(
  outputDir: string,
  url: string,
  timeoutMs: number
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SaveError(`服务返回了非法的图片 URL。`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SaveError(`图片 URL 协议不受支持：${parsed.protocol}`);
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  let buf: Buffer;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new SaveError(`下载生成的图片失败：HTTP ${res.status}`);
    checkSize(Number(res.headers.get("content-length")));
    if (!res.body) throw new SaveError("图片内容为空。");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
      checkSize(bytes);
      chunks.push(chunk);
    }
    buf = Buffer.concat(chunks, bytes);
  } catch (err) {
    controller.abort();
    if (err instanceof SaveError) throw err;
    if (signal.reason?.name === "TimeoutError") throw new SaveError("下载生成的图片超时。");
    throw new SaveError(
      `下载生成的图片失败：${err instanceof Error ? err.message : String(err)}`
    );
  }
  return writeBuffer(outputDir, buf);
}
