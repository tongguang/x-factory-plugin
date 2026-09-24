import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PluginConfig {
  /** API 前缀，例如 https://api.example.com/v1；不自动添加 /v1。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次请求超时（毫秒），默认 180000 */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 180000;
const SUPPORTED_MODELS = new Set([
  "gpt-image-2.5-flare",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-sunburst-2026-09-08",
]);

export function configPath(): string {
  // 用户配置独立于插件安装目录，更新插件不会覆盖配置。
  const override = process.env.IMAGE_GEN_CONFIG;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), ".factory", "plugin-config", "image-gen", "config.json");
}

const TEMPLATE = `{
  "baseUrl": "",
  "apiKey": "",
  "model": "",
  "timeoutMs": ${DEFAULT_TIMEOUT_MS}
}
`;

export class ConfigError extends Error {}

/**
 * 读取并校验用户配置。
 * 文件不存在时创建空值模板（不覆盖已有文件），然后抛出提示。
 * 任何情况下都不会把 apiKey 写进错误消息。
 */
export async function loadConfig(file: string = configPath()): Promise<PluginConfig> {
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, TEMPLATE, { encoding: "utf8", flag: "wx", mode: 0o600 }).catch((err) => {
      if (err.code !== "EEXIST") throw new ConfigError(`无法创建配置文件 ${file}，请检查目录权限。`);
    });
    throw new ConfigError(
      `尚未配置生图服务。请编辑 ${file} ，填写 baseUrl、apiKey、model 后重试。`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new ConfigError(`配置文件 ${file} 不是合法 JSON，请修正后重试。`);
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`配置文件 ${file} 必须是 JSON 对象。`);
  }
  const obj = raw as Record<string, unknown>;
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  const apiKey = typeof obj.apiKey === "string" ? obj.apiKey.trim() : "";
  const model = typeof obj.model === "string" ? obj.model.trim() : "";
  const timeoutMs =
    typeof obj.timeoutMs === "number" && obj.timeoutMs > 0
      ? Math.floor(obj.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl");
  if (!apiKey) missing.push("apiKey");
  if (!model) missing.push("model");
  if (missing.length > 0) {
    throw new ConfigError(
      `配置文件 ${file} 缺少必填项：${missing.join("、")}。请填写后重试。`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ConfigError("配置文件中的 baseUrl 不是合法 URL。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError("baseUrl 仅支持 http/https。");
  }
  if (!SUPPORTED_MODELS.has(model)) {
    throw new ConfigError("model 仅支持 GPT Image 2.5 Flare / Sunburst 的别名及 2026-09-08 快照名。");
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs };
}
