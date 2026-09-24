import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  defaultOutputDir,
  editImageSchema,
  executeEditImage,
  executeGenerateImage,
  generateImageSchema,
  PartialGenerationError,
} from "./tools.js";

const HELP = `Factory 图片生成与编辑

用法：node image-gen.cjs <generate|edit> --input <请求.json> [--output-dir <目录>]

请求：prompt（必填）、count（1～4，默认 1）、size（可选 auto 或符合 GPT Image 2.5 规则的宽x高）、transparent（可选布尔值，true 请求原生透明背景）。输出固定请求 PNG。
自定义尺寸：宽高均为 16 的倍数、单边不超过 3840、长短边比例不超过 3:1、总像素为 655,360～8,294,400。
edit 还需要 imagePath（一张参考图的绝对路径，文件非空且小于 50,000,000 字节）。
模型仅支持 GPT Image 2.5 Flare / Sunburst 的别名和 2026-09-08 快照；单张输出的本地上限为 64 MiB。
输出目录默认为当前工作目录下的 generated-images。
成功输出 JSON，失败向 stderr 输出错误并以非零状态退出。
部分失败时 stdout 仍输出已保存路径和 error；不要自动重发。
仅使用 Images API：生成 /images/generations，编辑 /images/edits。
多张图片通过 n 参数一次请求，失败或返回不足时不自动重试或补发。
配置默认为 ~/.factory/plugin-config/image-gen/config.json，可用 IMAGE_GEN_CONFIG 覆盖。`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string" },
      "output-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const [command] = positionals;
  if (positionals.length !== 1 || (command !== "generate" && command !== "edit")) {
    throw new Error("请选择 generate 或 edit；使用 --help 查看用法。");
  }
  if (!values.input) throw new Error("缺少 --input 请求 JSON 文件。");

  const content = await readFile(values.input, "utf8");
  let input: unknown;
  try {
    input = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("请求文件不是合法 JSON，请修正后重试。");
  }
  const outputDir = values["output-dir"]
    ? path.resolve(values["output-dir"])
    : defaultOutputDir();
  const result = command === "generate"
    ? await executeGenerateImage(z.object(generateImageSchema).parse(input), undefined, outputDir)
    : await executeEditImage(z.object(editImageSchema).parse(input), undefined, outputDir);
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  if (error instanceof PartialGenerationError) console.log(JSON.stringify(error.result));
  const message = error instanceof z.ZodError
    ? `请求参数无效：${error.issues.map((issue) => `${issue.path.join(".") || "请求"}: ${issue.message}`).join("；")}`
    : error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
