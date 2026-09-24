# image-gen CLI

本文说明 [image-gen](../README.md) 的直接调用方式、输入输出协议和开发验证。

## 调用方式

在仓库根目录完成 `npm ci` 和 `npm test` 后，可直接运行已构建的 bundle。请求 JSON 放在系统临时目录，使用 UUID 等唯一文件名，执行结束后清理。通过文件写入工具或 JSON 序列化写入 UTF-8，不把提示词直接拼接进 shell 命令。

以下 PowerShell 示例从仓库根目录执行；在其他项目中调用时，使用 bundle 的绝对路径，保持工作目录不变：

```powershell
$imageGenInput = Join-Path ([System.IO.Path]::GetTempPath()) ("image-gen-" + [guid]::NewGuid().ToString("N") + ".json")
$imageGenRequest = @{ prompt = '雨后的城市街道，暖色路灯，电影质感'; count = 1 }
try {
  [System.IO.File]::WriteAllText($imageGenInput, ($imageGenRequest | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
  node plugins/image-gen/dist/image-gen.cjs generate --input $imageGenInput --output-dir generated-images
} finally {
  Remove-Item -LiteralPath $imageGenInput -ErrorAction SilentlyContinue
}
```

编辑时将子命令换成 `edit`，并在请求对象中加入参考图的绝对路径 `imagePath`。Linux 和 macOS 同样使用系统临时目录中的唯一请求文件，只清理本次创建的文件，不删除用户文件或生成图片。

文生图请求：

```json
{
  "prompt": "雨后的城市街道，暖色路灯，电影质感",
  "count": 1,
  "size": "1024x1024"
}
```

编辑请求：

```json
{
  "prompt": "把背景改成白色，保留主体",
  "imagePath": "F:\\Work\\项目\\参考图.png",
  "count": 1
}
```

`prompt` 必填；`count` 默认为 1，必须为 1～4 的整数。`size` 可省略，也可为 `"auto"` 或 `"宽x高"`。自定义宽高均须为 16 的倍数且不超过 3840，长短边比例不超过 3:1，总像素须在 655,360～8,294,400 之间；不符合规则的值会在发送请求前被拒绝。常用尺寸包括 `1024x1024`、`1536x1024`、`2048x1152`、`3840x2160`；超过 3,686,400 像素（2560×1440）的自定义尺寸属实验性。[OpenAI 尺寸说明](https://developers.openai.com/api/docs/guides/image-generation)

编辑的 `imagePath` 必须是存在的绝对文件路径，支持 PNG、JPG、JPEG、WebP，文件非空且严格小于 50,000,000 字节；当前每次只能编辑一张图片。[OpenAI 编辑接口说明](https://developers.openai.com/api/reference/cli/resources/images/methods/edit)

文生图和编辑请求都固定向服务发送 `output_format: "png"`，包括普通非透明请求。两种请求也都可选填 `"transparent": true`：仅设置为 `true` 时，额外发送 `background: "transparent"`；省略或设为 `false` 时不发送背景参数。`transparent` 必须是布尔值。输出格式固定请求 PNG，不提供 WebP 选项。透明请求使用 PNG 的真实 Alpha 通道，不应让模型绘制棋盘格来模拟透明。自定义服务若不支持相关参数，插件保留其原始错误。示例：

```json
{
  "prompt": "画一个透明背景的图标",
  "transparent": true
}
```

编辑时同样在请求 JSON 中加入 `"transparent": true`，并保留必填的 `imagePath`。

`--input` 必填。省略 `--output-dir` 时，图片保存到当前工作目录下的 `generated-images/`；Skill 会显式指定当前项目的绝对输出目录。提示词通过 JSON 文件传递，避免引号、换行及 shell 特殊字符改变请求。

成功时，标准输出仅包含 JSON：

```json
{
  "paths": ["F:\\Work\\项目\\generated-images\\img-example.png"],
  "requested": 1,
  "prompt": "雨后的城市街道，暖色路灯，电影质感"
}
```

`paths` 是实际保存成功的图片绝对路径，`requested` 是用户请求的总张数，`prompt` 保留原始输入。

| 结果 | 标准输出 | 标准错误 | 退出码 |
| --- | --- | --- | --- |
| 成功 | 上述 JSON | 空 | `0` |
| 尚未保存图片就失败 | 空 | 错误说明 | `1` |
| 保存部分图片后失败 | 上述字段加 `error` | 错误说明 | `1` |

部分失败示例：

```json
{
  "paths": ["F:\\Work\\项目\\generated-images\\img-example.png"],
  "requested": 3,
  "prompt": "雨后的城市街道，暖色路灯，电影质感",
  "error": "[images] 下载生成的图片失败：HTTP 500"
}
```

调用方在非零退出时也应读取标准输出，展示已经保存的图片，并说明后续保存已停止。超时意味着执行结果可能未知，不自动重复整个任务或补发图片。

## 服务协议

插件仅接受 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare-2026-09-08`、`gpt-image-2.5-sunburst-2026-09-08`；配置中的其他模型会在发送请求前被拒绝。可保留自定义 `baseUrl`，但该地址须实现相应的 OpenAI Images API 语义。插件使用两个端点：

| 操作 | 追加到 `baseUrl` 的路径 | 请求格式 |
| --- | --- | --- |
| 文生图 | `/images/generations` | JSON |
| 参考图编辑 | `/images/edits` | multipart |

每次通过 `n` 指定张数，`size` 可选，响应支持 `data[].b64_json` 和 `data[].url`。服务必须支持所请求的数量和尺寸；实际返回不足时保存已有结果，不拆成多次请求或自动补发。

文生图的 JSON 和编辑的 multipart 均发送 `output_format=png`；仅请求透明背景时再发送 `background=transparent`。插件直接保存服务返回的图片字节，不进行格式转换，以保留 PNG 中的 Alpha 通道。

输出按文件头识别 PNG、JPEG、WebP、GIF，并选择对应扩展名，单张本地上限为 64 MiB。这是插件限制，不是 OpenAI 公布的输出限制。文件内容优先于下载响应的 `Content-Type`；HTML、普通文本及无法识别的内容会报错。这里只做轻量格式识别，不验证整张图片能否完整解码。

## 开发与验证

在仓库根目录运行 `npm ci`、`npm test`；测试命令已包含构建，无须提前再构建一次。测试使用模拟服务，不调用真实付费接口。发布文件 `dist/image-gen.cjs` 包含运行依赖，须随源码提交；安装后运行不依赖源码或开发目录中的 `node_modules`。

Skill 中的 `${DROID_PLUGIN_ROOT}` 由 Factory 展开，用于定位安装后的 bundle；它不是可直接复制到普通终端使用的环境变量。

需要验证独立 bundle 时，可把 `IMAGE_GEN_TEST_BUNDLE` 设为该 bundle 的绝对路径，再运行 `node --test plugins/image-gen/tests/cli.integration.test.js`。测试使用隔离配置和本地模拟服务，不读取真实服务配置。
