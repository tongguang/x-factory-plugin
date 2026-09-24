# image-gen

Factory Droid 图片生成与编辑插件，使用 GPT Image 2.5 Flare / Sunburst 的 Images API 生成图片并保存到当前项目。

- 文生图与单张参考图编辑。
- 自然语言调用或 `/image-gen`，支持指定张数、尺寸和透明背景。
- 图片默认保存到当前项目的 `generated-images/`，编辑结果另存为新文件。

## 安装与使用

需要 Node.js 22 或更高版本。按[仓库安装说明](../../README.md#安装)安装插件，然后在 Droid 中输入：

```text
/image-gen 画一张雨后的城市街道，暖色路灯，电影质感。
```

也可以直接用自然语言描述需求：

```text
生成两张 1024x1024 的咖啡店海报。
根据这张图片把背景改成白色，保留主体。
画一个透明背景的图标。
```

## 配置

配置文件位于 `~/.factory/plugin-config/image-gen/config.json`。首次运行若缺少文件，会创建空模板并提示填写；也可以复制 [config.example.json](config.example.json) 到该位置。

```json
{
  "baseUrl": "https://your-api.example/v1",
  "apiKey": "在本机填写真实密钥",
  "model": "gpt-image-2.5-flare",
  "timeoutMs": 180000
}
```

- `baseUrl`：服务的 API 前缀，通常以 `/v1` 结尾。插件追加 `/images/generations` 或 `/images/edits`，不会自动添加 `/v1`，请勿填写完整图片端点。
- `apiKey`：服务提供的密钥。
- `model`：仅支持 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare-2026-09-08`、`gpt-image-2.5-sunburst-2026-09-08`。Flare 适合较快生成，Sunburst 优先画质；插件不会自动切换模型。
- `timeoutMs`：每次 HTTP 请求的超时，单位毫秒，默认 `180000`。

配置修改后下次调用生效，已有配置不会被自动覆盖。可用 `IMAGE_GEN_CONFIG` 环境变量指定其他配置文件，建议使用绝对路径；相对路径以当前工作目录解析。请勿将真实配置或密钥提交到仓库，或把密钥写入提示词。

## 使用边界

- 每次请求 1～4 张。`size` 可省略，也可设为 `auto` 或自定义 `宽x高`：宽高都是 16 的倍数且不超过 3840，长短边比例不超过 3:1，总像素为 655,360～8,294,400。常用尺寸如 `1024x1024`、`2048x1152`、`3840x2160`；超过 3,686,400 像素（2560×1440）的自定义尺寸属实验性。[尺寸说明](https://developers.openai.com/api/docs/guides/image-generation)
- 生成和编辑请求都固定传 `output_format=png`。明确要求透明背景、Alpha 通道或透明去背时，设置 `transparent: true`，额外请求原生透明背景；省略或设为 `false` 时不传背景参数。不使用棋盘格模拟透明。
- 编辑会将一张参考图上传到所配置的服务。参考图支持 PNG、JPG、JPEG、WebP，须非空且严格小于 50,000,000 字节，不覆盖原图。[编辑接口说明](https://developers.openai.com/api/reference/cli/resources/images/methods/edit)
- 单张输出的插件本地上限为 64 MiB。图片按原始字节保存，按文件头识别 PNG、JPEG、WebP、GIF；不验证完整解码。
- 自定义 `baseUrl` 必须支持相应的 OpenAI Images API 语义；服务不兼容时保留原始错误。
- 每次调用只发送一次生成或编辑请求。失败不自动重试，图片不足不补发；部分保存失败时保留已保存的图片。

直接调用 CLI、输入输出协议及开发验证方法见 [CLI 文档](docs/cli.md)。
