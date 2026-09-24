import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, configPath, ConfigError } from "../.build/config.js";

async function tmpDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "img-plugin-config-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    return rm(dir, { recursive: true, force: true });
  });
  return dir;
}

const VALID = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-key-not-real",
  model: "gpt-image-2.5-flare",
  timeoutMs: 5000,
};

test("配置路径使用用户目录，环境变量可覆盖且空白值回到默认路径", (t) => {
  const original = process.env.IMAGE_GEN_CONFIG;
  t.after(() => {
    if (original === undefined) delete process.env.IMAGE_GEN_CONFIG;
    else process.env.IMAGE_GEN_CONFIG = original;
  });
  delete process.env.IMAGE_GEN_CONFIG;
  assert.equal(configPath(), path.join(os.homedir(), ".factory", "plugin-config", "image-gen", "config.json"));
  process.env.IMAGE_GEN_CONFIG = "  自定义配置/config.json  ";
  assert.equal(configPath(), path.resolve("自定义配置/config.json"));
  process.env.IMAGE_GEN_CONFIG = "  ";
  assert.equal(configPath(), path.join(os.homedir(), ".factory", "plugin-config", "image-gen", "config.json"));
});

test("缺失配置时创建嵌套目录与空模板，填写后加载不覆盖原文件", async (t) => {
  const dir = await tmpDir(t);
  const file = path.join(dir, ".factory", "plugin-config", "image-gen", "config.json");
  await assert.rejects(loadConfig(file), /尚未配置/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutMs: 180000,
  });

  const content = JSON.stringify(VALID, null, 2) + "\n";
  await writeFile(file, content, "utf8");
  assert.deepEqual(await loadConfig(file), VALID);
  assert.equal(await readFile(file, "utf8"), content);
});

test("有效配置规范化字符串、使用默认超时并忽略未知字段", async (t) => {
  const dir = await tmpDir(t);
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify({
    baseUrl: `  ${VALID.baseUrl}/  `,
    apiKey: ` ${VALID.apiKey} `,
    model: ` ${VALID.model} `,
    apiType: "responses",
    responsesModel: "old-main-model",
  }), "utf8");
  assert.deepEqual(await loadConfig(file), { ...VALID, timeoutMs: 180000 });
});

test("仅接受 GPT Image 2.5 的 Flare、Sunburst 别名和官方快照", async (t) => {
  const dir = await tmpDir(t);
  const file = path.join(dir, "config.json");
  for (const model of [
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5-flare-2026-09-08",
    "gpt-image-2.5-sunburst-2026-09-08",
  ]) {
    await writeFile(file, JSON.stringify({ ...VALID, model }), "utf8");
    assert.equal((await loadConfig(file)).model, model);
  }
  for (const model of ["fake-image-model", "gpt-image-2", "gpt-image-2.5-flare-preview"]) {
    await writeFile(file, JSON.stringify({ ...VALID, model }), "utf8");
    await assert.rejects(loadConfig(file), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /model|GPT Image 2\.5/i);
      assert.ok(!err.message.includes(VALID.apiKey), "错误消息不得包含密钥");
      return true;
    });
  }
});

test("无效 JSON、配置结构和服务地址明确报错，不泄露密钥", async (t) => {
  const dir = await tmpDir(t);
  const file = path.join(dir, "config.json");
  const cases = [
    [`{"apiKey":"${VALID.apiKey}",`, /不是合法 JSON/],
    [JSON.stringify([VALID]), /必须是 JSON 对象/],
    [JSON.stringify({ apiKey: VALID.apiKey }), /baseUrl.*model/],
    [JSON.stringify({ ...VALID, baseUrl: "not-a-url" }), /不是合法 URL/],
    [JSON.stringify({ ...VALID, baseUrl: "ftp://api.example.com" }), /仅支持 http\/https/],
  ];
  for (const [content, message] of cases) {
    await writeFile(file, content, "utf8");
    await assert.rejects(loadConfig(file), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, message);
      assert.ok(!err.message.includes(VALID.apiKey), "错误消息不得包含密钥");
      return true;
    });
  }
});
