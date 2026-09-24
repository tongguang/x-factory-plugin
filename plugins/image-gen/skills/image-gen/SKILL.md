---
name: image-gen
description: 生成或编辑图片。当用户要求生成图片、画图、文生图，或基于一张已有本地图片按文字要求修改时使用。通过插件自带 Node.js CLI 调用用户配置的图片服务，将结果保存到当前项目并展示。
---

# 图片生成与编辑

## 选择操作

- 只有文字要求、没有指定参考图时，使用 `generate`。
- 用户提供一张本地参考图，或要求继续修改上一次生成的图时，使用 `edit`。
- 参考图只有相对路径或文件名时，按当前项目补全绝对路径并确认文件存在；无法确定目标图片时向用户确认。

## 请求参数

将请求保存到系统临时目录中的 UTF-8 JSON 文件，使用 UUID 等唯一文件名，不写到项目仓库或插件目录。系统临时目录可通过 Node.js 的 `os.tmpdir()` 或 PowerShell 的 `[System.IO.Path]::GetTempPath()` 获取。使用文件写入工具或安全的 JSON 序列化方式，不要把提示词直接拼进 shell 命令，也不要通过 shell 展开提示词中的特殊字符。

```json
{
  "prompt": "用户的图片要求",
  "count": 1
}
```

1. `prompt` 保留用户的原始要求，可以补全细节，但不要改变核心意图。
2. `count` 默认为 1；用户明确要求多张时使用 1～4。只执行一次 CLI，通过 Images API 的 `n` 请求指定张数。不要拆分请求、循环调用 CLI 或自动补发。用户一次要求超过 4 张时，先说明单次上限并确认数量。
3. `size` 只在用户明确要求时填写，例如 `"1024x1024"`；否则省略。具体尺寸是否支持取决于用户配置的服务。
4. `edit` 额外传入 `imagePath`，必须是存在的本地绝对路径，格式限 PNG / JPG / JPEG / WebP，文件非空且不超过 20 MiB。
5. 仅当用户明确要求透明背景、Alpha 通道或透明去背时，设置 `"transparent": true`；其他情况省略。生成和编辑都支持此参数。CLI 对所有请求固定发送 `output_format=png`，仅透明请求额外发送 `background=transparent`，并保留服务返回的原始图片字节。

## 执行

需要 Node.js 22 或更高版本。`${DROID_PLUGIN_ROOT}` 由 Factory 展开为插件安装路径。保持执行工作目录为用户当前项目，不要切换到插件目录。

先确定当前项目的绝对路径，计算其 `generated-images` 子目录的绝对路径，作为 `--output-dir`。按当前 shell 正确引用所有路径，执行一次：

```text
node "${DROID_PLUGIN_ROOT}/dist/image-gen.cjs" generate --input "<本次临时请求 JSON 的绝对路径>" --output-dir "<当前项目绝对路径>/generated-images"
```

编辑时只将子命令改为 `edit`，请求 JSON 需包含 `imagePath`：

```text
node "${DROID_PLUGIN_ROOT}/dist/image-gen.cjs" edit --input "<本次临时请求 JSON 的绝对路径>" --output-dir "<当前项目绝对路径>/generated-images"
```

等待这一次命令完成，不启动重复任务。CLI 只发送一次生成或编辑请求，依次保存返回的图片；任意请求、解析或保存失败即停止，不重试或补发。命令成功或失败后，删除本次创建的临时请求文件；不要删除用户原有文件或生成图片。

## 结果处理

- 退出码为 `0` 时解析标准输出 JSON，字段为 `paths`（实际图片绝对路径列表）、`requested`（请求总张数）、`prompt`（本次提示词）。
- 退出码非零时也检查标准输出。若有 JSON，表示已保存部分图片，除上述字段外还有 `error`；展示其中的图片并说明“已保存 X 张，原请求 Y 张，后续保存已停止”。标准输出为空时，根据标准错误说明失败原因。
- 如实报告实际张数，并按返回的绝对路径展示每张图片。路径包含空格时使用尖括号，例如 `![生成结果](<F:/Work/项目 图片/generated-images/img-example.png>)`。不要猜测文件名或替换成插件目录。
- 实际张数少于 `requested` 时明确告知，不自行补发请求。
- 失败时不自动重试 CLI 或补发图片；超时或限流也不重试，超时的服务端执行结果可能未知。错误或输出若意外含有密钥，先隐藏密钥再展示。

## 配置与边界

- 默认配置位于 `~/.factory/plugin-config/image-gen/config.json`；`IMAGE_GEN_CONFIG` 具有最高优先级，可指定其他路径。配置缺失时 CLI 会创建空模板并提示填写。
- 插件只使用 Images API：文生图请求 `/images/generations`，参考图编辑请求 `/images/edits`。路径追加到配置中的 `baseUrl`，不自动添加 `/v1`。
- 兼容服务或旧模型可能不支持 `output_format=png` 或 `background=transparent`；若服务报错，如实说明，不自动更换服务或模型。
- 不主动读取或展示配置文件内容，不输出密钥，也不猜测服务地址、密钥或模型名。配置问题引导用户填写 `baseUrl`、`apiKey`、`model`，不要自行更改用户的服务或模型选择。
- 编辑会将参考图上传到用户配置的图片服务。输出保存为新文件，不覆盖参考图。
- 输出按文件头识别 PNG、JPEG、WebP、GIF，单张上限 25 MiB；格式识别优先于下载响应的 `Content-Type`。无法识别的内容会报错，不把 HTML 或文本当作图片展示。轻量格式识别不代表完整解码验证。
- 不做多提示词批量队列；用户给出多个不同提示词时，逐个确认后分别调用。
