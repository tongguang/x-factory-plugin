import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadConfig, type PluginConfig } from "./config.js";
import {
  saveImageItem,
  ApiError,
  requestEdit,
  requestGeneration,
  type ImagesResponse,
} from "./api.js";

/** 每次调用以当前项目为准，不依赖插件安装位置。 */
export function defaultOutputDir(): string {
  return path.resolve("generated-images");
}

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const REFERENCE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export const generateImageSchema = {
  prompt: z.string().min(1).describe("生图提示词"),
  count: z
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe("生成张数，1～4，默认 1，通过 Images API 的 n 参数一次请求"),
  size: z
    .string()
    .optional()
    .describe("图片尺寸，例如 1024x1024。仅在你的服务支持时填写，留空使用服务默认"),
  transparent: z.boolean().optional().describe("设为 true 时请求透明背景；省略或 false 不请求透明背景。输出始终为 PNG"),
};

export const editImageSchema = {
  prompt: z.string().min(1).describe("修改要求，例如：把背景换成白色，保留主体"),
  imagePath: z
    .string()
    .min(1)
    .describe("参考图的本地绝对路径"),
  count: z.number().int().min(1).max(4).default(1).describe("生成张数，1～4，默认 1"),
  size: z.string().optional().describe("图片尺寸，留空使用服务默认"),
  transparent: z.boolean().optional().describe("设为 true 时请求透明背景；省略或 false 不请求透明背景。输出始终为 PNG"),
};

export type GenerateImageArgs = {
  prompt: string;
  count: number;
  size?: string;
  transparent?: boolean;
};

export type EditImageArgs = {
  prompt: string;
  imagePath: string;
  count: number;
  size?: string;
  transparent?: boolean;
};

export interface ToolResult {
  paths: string[];
  requested: number;
  prompt: string;
}

export class InputError extends Error {}

export class PartialGenerationError extends Error {
  constructor(readonly result: ToolResult & { error: string }) {
    super(result.error);
  }
}

async function executeImages(
  args: GenerateImageArgs,
  config: PluginConfig,
  outputDir: string,
  request: () => Promise<ImagesResponse>
): Promise<ToolResult> {
  const result: ToolResult = { paths: [], requested: args.count, prompt: args.prompt };
  try {
    const response = await request();
    if (!Array.isArray(response.data) || !response.data.length) {
      throw new ApiError("生图服务响应中没有图片数据。");
    }
    for (const item of response.data) {
      result.paths.push(await saveImageItem(outputDir, item, config.timeoutMs));
    }
    return result;
  } catch (err) {
    const message = `[images] ${err instanceof Error ? err.message : String(err)}`
      .replaceAll(config.apiKey, "[已隐藏]");
    if (result.paths.length) throw new PartialGenerationError({ ...result, error: message });
    throw new ApiError(message, err instanceof ApiError ? err.status : undefined);
  }
}

async function readReferenceImage(imagePath: string): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
}> {
  if (!path.isAbsolute(imagePath)) {
    throw new InputError(`参考图必须使用绝对路径：${imagePath}`);
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mime = REFERENCE_MIME[ext];
  if (!mime) {
    throw new InputError(
      `不支持的参考图格式 ${ext || "(无扩展名)"}，仅支持 png / jpg / jpeg / webp。`
    );
  }
  let info;
  try {
    info = await stat(imagePath);
  } catch {
    throw new InputError(`参考图不存在：${imagePath}`);
  }
  if (!info.isFile()) throw new InputError(`参考图不是文件：${imagePath}`);
  if (info.size === 0) throw new InputError(`参考图内容为空：${imagePath}`);
  if (info.size > MAX_REFERENCE_BYTES) {
    throw new InputError(`参考图超过 20MB 上限：${imagePath}`);
  }
  const buffer = await readFile(imagePath);
  return { buffer, filename: path.basename(imagePath), mime };
}

/** 文生图，返回结构化结果（含已保存路径）。 */
export async function executeGenerateImage(
  args: GenerateImageArgs,
  config?: PluginConfig,
  outputDir: string = defaultOutputDir()
): Promise<ToolResult> {
  const cfg = config ?? (await loadConfig());
  return executeImages(args, cfg, outputDir, () => requestGeneration(cfg, {
    prompt: args.prompt,
    count: args.count,
    size: args.size,
    transparent: args.transparent,
  }));
}

/** 参考图编辑，返回结构化结果（含已保存路径） */
export async function executeEditImage(
  args: EditImageArgs,
  config?: PluginConfig,
  outputDir: string = defaultOutputDir()
): Promise<ToolResult> {
  const cfg = config ?? (await loadConfig());
  const image = await readReferenceImage(args.imagePath);
  return executeImages(args, cfg, outputDir, () => requestEdit(cfg, {
    prompt: args.prompt,
    count: args.count,
    size: args.size,
    transparent: args.transparent,
    image,
  }));
}
