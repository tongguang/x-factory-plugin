# image-gen

Factory Droid 图片生成与编辑插件。Skill 根据用户要求调用随插件发布的 Node.js CLI，通过 OpenAI 兼容 Images API 请求图片，并保存到当前项目。

支持文生图、单张参考图编辑、每次请求 1～4 张图片和可选尺寸。服务是否支持多张及具体尺寸取决于所配置的服务。编辑会将参考图上传到该服务；保存结果使用新文件，不覆盖参考图。

## 安装与使用

需要 Node.js 22 或更高版本。GitHub 用户级安装方式见[仓库说明](../../README.md#安装)。

在 Droid 中使用 `/image-gen`，或直接输入：

```text
画一张雨后的城市街道，暖色路灯，电影质感。
根据这张图片把背景改成白色，保留主体。
```

生成图片默认保存到当前项目的 `generated-images/`，Skill 会展示 CLI 返回的本地图片。每次调用只发送一次生成或编辑请求；请求失败不自动重试，返回图片不足时不自动补发。

输出支持 PNG、JPEG、WebP、GIF，按文件头识别格式并选择扩展名，单张图片上限为 25 MiB。文件内容优先于下载响应的 `Content-Type`；HTML、普通文本及无法识别的内容会报错。这里只做轻量格式识别，不验证整张图片能否完整解码。

## 配置

默认配置文件为 `~/.factory/plugin-config/image-gen/config.json`。首次运行若缺少文件，会创建空配置模板并提示填写；也可以从 `config.example.json` 复制模板到该位置。已有配置不会被自动覆盖。

```json
{
  "baseUrl": "https://your-api.example/v1",
  "apiKey": "在本机填写真实密钥",
  "model": "你的生图模型名称",
  "timeoutMs": 180000
}
```

- `baseUrl`：图片服务的 API 前缀，通常以 `/v1` 结尾。
- `apiKey`：服务提供的密钥。
- `model`：服务支持的生图模型名称。
- `timeoutMs`：每次 HTTP 请求的超时，单位毫秒，默认 180000。

插件只使用以下两个 Images API 端点：

| 操作 | 追加到 `baseUrl` 的路径 | 请求格式 |
| --- | --- | --- |
| 文生图 | `/images/generations` | JSON |
| 参考图编辑 | `/images/edits` | multipart |

例如 `https://your-api.example/v1` 加上 `/images/generations` 得到 `https://your-api.example/v1/images/generations`。插件不自动添加 `/v1`，不要在 `baseUrl` 填完整的图片端点。

每次通过 `n` 指定张数，`size` 可选。服务必须支持所请求的数量和尺寸；实际返回不足时保存已有结果，不拆成多次请求或自动补发。响应支持 `data[].b64_json` 和 `data[].url`。编辑会上传原始参考图，输出另存为新文件。

配置每次运行重新读取，修改后下次调用生效；插件升级不覆盖已有配置。`IMAGE_GEN_CONFIG` 环境变量具有最高优先级，可覆盖默认配置路径。建议使用绝对路径；相对路径以当前工作目录解析。不要将真实配置或密钥提交到 GitHub，也不要把密钥写入提示词或命令行。

## CLI

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

`prompt` 必填；`count` 默认为 1，必须为 1～4 的整数；`size` 可省略以使用服务默认值。编辑的 `imagePath` 必须是存在的绝对文件路径，支持 PNG、JPG、JPEG、WebP，文件非空且不超过 20 MiB。

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

## 开发与验证

在仓库根目录运行 `npm ci`、`npm test`；测试命令已包含构建，无须提前再构建一次。测试使用模拟服务，不调用真实付费接口。发布文件 `dist/image-gen.cjs` 包含运行依赖，须随源码提交；安装后运行不依赖源码或开发目录中的 `node_modules`。

Skill 中的 `${DROID_PLUGIN_ROOT}` 由 Factory 展开，用于定位安装后的 bundle；它不是可直接复制到普通终端使用的环境变量。

需要验证安装缓存中的 bundle 时，可把 `IMAGE_GEN_TEST_BUNDLE` 设为该 bundle 的绝对路径，再运行 `node --test plugins/image-gen/tests/cli.integration.test.js`。测试使用隔离配置和本地模拟服务，不读取真实服务配置。
