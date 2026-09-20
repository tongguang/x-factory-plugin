# x-factory-plugin

面向 [Factory Droid](https://docs.factory.ai/harness/plugins) 的插件集合，为日常开发提供可通过自然语言或斜杠命令调用的工具。

## 插件

| 插件 | 功能 |
| --- | --- |
| [image-gen](plugins/image-gen/README.md) | 根据文字生成图片，或编辑一张本地参考图；支持每次生成 1～4 张，结果保存到当前项目。 |

## 安装

需要 Factory Droid 和 Node.js 22 或更高版本。

```sh
droid plugin marketplace add https://github.com/tongguang/x-factory-plugin
droid plugin install image-gen@x-factory-plugin --scope user
```

安装后，当前用户的所有项目都可以使用插件。完成 [image-gen 配置](plugins/image-gen/README.md#配置)并重新启动 Droid 会话，即可开始使用：

```text
/image-gen 画一张雨后的城市街道，暖色路灯，电影质感
```

也可以直接用自然语言描述图片要求。生成结果默认保存在当前项目的 `generated-images/`。

## 更新

```sh
droid plugin marketplace update x-factory-plugin
droid plugin update image-gen@x-factory-plugin --scope user
```

更新后重新启动 Droid 会话。插件配置保存在 `~/.factory/plugin-config/<插件名>/`，独立于安装目录。

## 开发

```sh
npm ci
npm test
```

各插件位于 `plugins/<插件名>/`，由根目录的 `.factory-plugin/marketplace.json` 统一登记。`npm test` 包含构建与模拟服务测试，GitHub Actions 在 Windows 和 Linux 上验证。

插件自带运行所需的 bundle，使用者无须安装 npm 依赖。修改源码后需同步提交构建产物；新增插件时，按 [Factory 插件规范](https://docs.factory.ai/harness/plugins)组织目录并登记到 marketplace。

## 许可证

[MIT](LICENSE)
