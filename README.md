# x-factory-plugin

用于开发和分发 [Factory Droid 插件](https://docs.factory.ai/harness/plugins)的仓库。每个插件独立放在 `plugins/` 下，根目录的 marketplace 统一登记插件。

首个插件是 [image-gen](plugins/image-gen/README.md)：通过自然语言或 `/image-gen` 使用 Images API 生成、编辑图片，结果保存在当前项目中。

## 安装

需要 Factory Droid 和 Node.js 22 或更高版本。直接从 GitHub 安装已构建的插件：

已登记同名本地 marketplace 的用户，先按[切换安装源](#切换安装源)移除旧登记，再执行安装命令。

```sh
droid plugin marketplace add https://github.com/tongguang/x-factory-plugin
droid plugin install image-gen@x-factory-plugin --scope user
```

`--scope user` 让当前用户的所有项目都能使用插件。首次使用前，在 `~/.factory/plugin-config/image-gen/config.json` 填入 `baseUrl`、`apiKey`、`model`，具体见 [image-gen 配置说明](plugins/image-gen/README.md#配置)。Windows 上 `~` 指当前用户目录，例如 `C:\Users\用户名`。

重新启动 Droid 会话后，可在任意项目中输入 `/image-gen`，或直接要求生成、编辑图片。图片默认保存在当前项目的 `generated-images/`。

## 更新

```sh
droid plugin marketplace update x-factory-plugin
droid plugin update image-gen@x-factory-plugin --scope user
```

更新后重新启动 Droid 会话。用户配置独立保存在 `~/.factory/plugin-config/<插件名>/`，不会被插件更新覆盖。

## 目录

```text
.factory-plugin/marketplace.json    # Factory marketplace 清单
.github/workflows/                 # Windows / Linux 构建与测试
plugins/
  image-gen/
    .factory-plugin/plugin.json    # 插件元数据
    skills/image-gen/SKILL.md       # Droid Skill
    src/                           # TypeScript 源码与 CLI
    tests/                         # 模拟服务测试
    dist/image-gen.cjs              # 随仓库提交的独立运行文件
    config.example.json            # 配置示例，不含真实密钥
package.json                       # npm workspaces 与统一命令
```

## 开发

需要 Node.js 22 或更高版本及 npm。在仓库根目录执行：

```sh
npm ci
npm test
```

`npm test` 会先构建，再运行测试；仅需构建时可单独运行 `npm run build`。构建会把 CLI 及运行依赖打包到 `plugins/image-gen/dist/image-gen.cjs`。这个文件需要与源码一同提交；安装者只需 Node.js，无须在 Factory 插件缓存中运行 `npm install`。CI 在 Windows 和 Linux 运行构建、测试，并检查 bundle 是否与源码一致。

`node_modules`、`.build`、真实配置、临时文件及生成图片不入库。服务密钥只保存在用户配置中。请求 JSON 使用系统临时目录中的唯一文件名，执行结束后清理；不要把真实请求或历史图片复制到仓库。

### 本地安装与验证

完成构建与测试后，可从仓库根目录登记本地 marketplace，验证开发中的插件。如果已登记 GitHub 来源，先按[切换安装源](#切换安装源)移除原登记。

```sh
droid plugin marketplace add .
droid plugin install image-gen@x-factory-plugin --scope user
```

修改代码后运行 `npm test`，再更新本地安装：

```sh
droid plugin marketplace update x-factory-plugin
droid plugin update image-gen@x-factory-plugin --scope user
```

发布新版本时，同步更新插件的 `package.json`、根 `package-lock.json` 中的 workspace 版本、插件清单及 marketplace 中的版本号，运行 `npm test`，并提交同步构建的 bundle。

### 切换安装源

本地开发与 GitHub 安装共用 `x-factory-plugin` 名称。切换来源前，先卸载插件并移除原 marketplace 登记：

```sh
droid plugin uninstall image-gen@x-factory-plugin --scope user
droid plugin marketplace remove x-factory-plugin
```

然后按目标来源重新添加 marketplace 并安装插件。用户配置和各项目生成的图片独立保存，无须移动或删除。

## 新增插件

1. 在 `plugins/<插件名>/` 创建独立目录，添加 `.factory-plugin/plugin.json` 和所需的 Skill、脚本或其他插件组件。
2. 在根 marketplace 的 `plugins` 中登记名称及 `./plugins/<插件名>` 来源。
3. 如果插件需要 Node.js 构建，提供自己的 `package.json`、构建和测试命令，由根 npm workspaces 统一执行。
4. 提供中文使用说明、无密钥配置示例，并检查安装后的发布文件能独立运行。

插件结构遵循 [Factory 插件文档](https://docs.factory.ai/harness/plugins)和 [Skill 文档](https://docs.factory.ai/harness/skills)。保持各插件独立，按实际需要添加共享代码。
