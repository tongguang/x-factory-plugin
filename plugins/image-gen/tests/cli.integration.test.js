import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE = process.env.IMAGE_GEN_TEST_BUNDLE
  ? path.resolve(process.env.IMAGE_GEN_TEST_BUNDLE)
  : fileURLToPath(new URL("../dist/image-gen.cjs", import.meta.url));
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");
// 真实 1×1 图片夹具，保留两个 GIF 版本的文件头。
const IMAGE_SAMPLES = [
  { name: "PNG", extension: ".png", b64: PNG_B64, contentType: "text/html" },
  {
    name: "JPEG", extension: ".jpg",
    b64: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
  },
  { name: "WebP", extension: ".webp", b64: "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=", contentType: "application/octet-stream" },
  { name: "GIF87a", extension: ".gif", b64: "R0lGODdhAQABAIEAAP8AAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==", contentType: "image/png" },
  { name: "GIF89a", extension: ".gif", b64: "R0lGODlhAQABAIEAAAAAAAAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAgEAAEEBAA7", contentType: "image/gif" },
].map((sample) => ({ ...sample, bytes: Buffer.from(sample.b64, "base64") }));
const TEST_KEY = "image-gen-integration-not-a-real-key";
const COMPLEX_PROMPT = '中文提示词，包含 "引号"、反斜线 \\、`反引号` 和 $(不应执行)\n第二行：保留全部细节 🎨';

function json(body, status = 200) {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function oneImage() {
  return json({ data: [{ b64_json: PNG_B64 }] });
}

async function fixture(t, handler = oneImage, timeoutMs = 5000) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "图片插件 集成测试-"));
  const calls = [];
  let server;
  t.after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await rm(dir, { recursive: true, force: true });
  });

  const pluginDir = path.join(dir, "独立发布文件");
  const cwdA = path.join(dir, "项目 A");
  const cwdB = path.join(dir, "项目 B");
  await Promise.all([pluginDir, cwdA, cwdB].map((p) => mkdir(p)));
  const bundle = path.join(pluginDir, "image-gen.cjs");
  await copyFile(BUNDLE, bundle);

  let origin;
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const call = { url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) };
    calls.push(call);
    const response = await handler(call, origin, res);
    // null 表示由 handler 直接控制响应流，或故意不响应以验证超时。
    if (response === null) return;
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const config = path.join(dir, "隔离配置.json");
  await writeFile(config, JSON.stringify({
    baseUrl: `${origin}/v1`, apiKey: TEST_KEY, model: "fake-image-model", timeoutMs,
  }));

  function invoke(args, cwd = cwdA, env = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bundle, ...args], {
        cwd,
        env: { ...process.env, IMAGE_GEN_CONFIG: config, NODE_PATH: "", NODE_OPTIONS: "", ...env },
        windowsHide: true,
        signal: AbortSignal.timeout(15000),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  let sequence = 0;
  async function run(command, body, { cwd = cwdA, outputDir, env } = {}) {
    const input = path.join(dir, `请求 ${++sequence}.json`);
    await writeFile(input, typeof body === "string" ? body : JSON.stringify(body), "utf8");
    const args = [command, "--input", input];
    if (outputDir) args.push("--output-dir", outputDir);
    return invoke(args, cwd, env);
  }

  return { dir, pluginDir, cwdA, cwdB, config, calls, invoke, run };
}

async function success(result, outputDir, requested, prompt, count = 1, { bytes = PNG, extension = ".png" } = {}) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(data).sort(), ["paths", "prompt", "requested"]);
  assert.equal(data.requested, requested);
  assert.equal(data.prompt, prompt);
  assert.equal(data.paths.length, count);
  for (const file of data.paths) {
    assert.ok(path.isAbsolute(file));
    assert.equal(path.dirname(file), outputDir);
    assert.equal(path.extname(file), extension);
    assert.deepEqual(await readFile(file), bytes);
  }
  return data;
}

function failure(result) {
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.trim(), "失败时应向 stderr 输出错误说明");
  assert.ok(!result.stderr.includes(TEST_KEY), "错误说明不得泄露密钥");
}

async function partialFailure(result, outputDir, requested, prompt, count = 1) {
  assert.notEqual(result.code, 0);
  assert.ok(result.stderr.trim());
  assert.ok(!result.stderr.includes(TEST_KEY));
  const data = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(data).sort(), ["error", "paths", "prompt", "requested"]);
  assert.equal(typeof data.error, "string");
  assert.ok(data.error.trim());
  assert.ok(!data.error.includes(TEST_KEY));
  const { error, ...saved } = data;
  await success({ code: 0, stderr: "", stdout: JSON.stringify(saved) }, outputDir, requested, prompt, count);
  return data;
}

test("独立 bundle 默认读取 plugin-config，不自动回退到旧配置目录", async (t) => {
  const f = await fixture(t);
  const userHome = path.join(f.dir, "模拟用户");
  const oldConfig = path.join(userHome, ".factory", "image-gen", "config.json");
  const newConfig = path.join(userHome, ".factory", "plugin-config", "image-gen", "config.json");
  const env = { HOME: userHome, USERPROFILE: userHome, IMAGE_GEN_CONFIG: "" };
  await mkdir(path.dirname(oldConfig), { recursive: true });
  await copyFile(f.config, oldConfig);

  const missing = await f.run("generate", { prompt: "新配置目录" }, { env });
  failure(missing);
  assert.ok(missing.stderr.includes(newConfig));
  assert.equal(f.calls.length, 0, "新配置缺失时不得使用旧目录的配置发起请求");
  assert.equal(JSON.parse(await readFile(newConfig, "utf8")).apiKey, "");

  await copyFile(f.config, newConfig);
  const result = await f.run("generate", { prompt: "新配置目录" }, { env });
  await success(result, path.join(f.cwdA, "generated-images"), 1, "新配置目录");
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(await readFile(oldConfig, "utf8")).apiKey, TEST_KEY);
});

test("独立 bundle 在中文空格路径运行，两个项目分别使用自己的默认输出目录", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readdir(f.pluginDir), ["image-gen.cjs"], "发布运行不需要源码、package.json 或 node_modules");
  const help = await f.invoke(["--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /--input/);
  assert.equal(f.calls.length, 0);
  for (const cwd of [f.cwdA, f.cwdB]) {
    const input = { prompt: COMPLEX_PROMPT };
    // 第二个项目同时验证 PowerShell 常见的 UTF-8 BOM 请求文件。
    const body = cwd === f.cwdB ? `\uFEFF${JSON.stringify(input)}` : input;
    const result = await f.run("generate", body, { cwd });
    await success(result, path.join(cwd, "generated-images"), 1, COMPLEX_PROMPT);
  }
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.url, "/v1/images/generations");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, `Bearer ${TEST_KEY}`);
    assert.deepEqual(JSON.parse(call.body), { model: "fake-image-model", prompt: COMPLEX_PROMPT, n: 1, output_format: "png" });
  }
});

test("显式输出目录、尺寸和多张请求被保留，图片文件互不覆盖", async (t) => {
  const f = await fixture(t, () => json({ data: Array.from({ length: 3 }, () => ({ b64_json: PNG_B64 })) }));
  const outputDir = path.join(f.dir, "新建输出", "三张 图片");
  const result = await f.run("generate", { prompt: "三只猫", count: 3, size: "1024x1024" }, { outputDir });
  const data = await success(result, outputDir, 3, "三只猫", 3);
  assert.equal(new Set(data.paths).size, 3);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body), {
    model: "fake-image-model", prompt: "三只猫", n: 3, size: "1024x1024", output_format: "png",
  });
});

test("文生图固定请求 PNG，仅 transparent 为 true 时请求透明背景，并原样保存半透明 RGBA", async (t) => {
  const f = await fixture(t);
  assert.equal(PNG[25], 6, "测试图片应为 RGBA PNG");
  assert.equal(inflateSync(PNG.subarray(41, 54))[4], 127, "测试图片应包含半透明像素");
  const outputDir = path.join(f.cwdA, "generated-images");
  await success(await f.run("generate", { prompt: "透明图标", transparent: true }), outputDir, 1, "透明图标");
  await success(await f.run("generate", { prompt: "普通图标", transparent: false }), outputDir, 1, "普通图标");
  assert.deepEqual(f.calls.map((call) => JSON.parse(call.body)), [
    { model: "fake-image-model", prompt: "透明图标", n: 1, background: "transparent", output_format: "png" },
    { model: "fake-image-model", prompt: "普通图标", n: 1, output_format: "png" },
  ]);
});

test("Base64 和 URL 图片按文件头保存四种格式，忽略错误或缺失的 MIME", async (t) => {
  let sample;
  let transport;
  const f = await fixture(t, (call, origin) => call.url === "/image.bin"
    ? { status: 200, headers: sample.contentType ? { "content-type": sample.contentType } : {}, body: sample.bytes }
    : json({ data: [transport === "base64" ? { b64_json: sample.b64 } : { url: `${origin}/image.bin` }] }));
  for (sample of IMAGE_SAMPLES) {
    for (transport of ["base64", "url"]) {
      const before = f.calls.length;
      const prompt = `${sample.name} ${transport}`;
      await success(await f.run("generate", { prompt }), path.join(f.cwdA, "generated-images"), 1, prompt, 1, sample);
      const calls = f.calls.slice(before);
      assert.deepEqual(calls.map(({ method, url }) => [method, url]), transport === "base64"
        ? [["POST", "/v1/images/generations"]]
        : [["POST", "/v1/images/generations"], ["GET", "/image.bin"]]);
      if (transport === "url") assert.equal(calls[1].headers.authorization, undefined, "图片下载不得附带 API 密钥");
    }
  }
});

test("Base64 和 URL 中的 HTML、普通文本、空内容均拒绝保存", async (t) => {
  let bytes;
  let transport;
  const f = await fixture(t, (call, origin) => call.url === "/invalid.png"
    ? { status: 200, headers: { "content-type": "image/png" }, body: bytes }
    : json({ data: [transport === "base64" ? { b64_json: bytes.toString("base64") } : { url: `${origin}/invalid.png` }] }));
  for (bytes of [Buffer.from("<html>CDN error</html>"), Buffer.from("not an image"), Buffer.alloc(0)]) {
    for (transport of ["base64", "url"]) {
      const before = f.calls.length;
      failure(await f.run("generate", { prompt: "拒绝无效图片" }));
      assert.equal(f.calls.length - before, transport === "base64" ? 1 : 2, "失败后不得重新生成或下载");
    }
  }
  assert.deepEqual(await readdir(path.join(f.cwdA, "generated-images")).catch(() => []), []);
});

test("25 MiB 边界同时适用于 Base64 与 URL，无长度头的超限流提前取消", async (t) => {
  const limit = 25 * 1024 * 1024;
  // 保留真实 PNG 开头并追加填充，验证大小边界，不依赖完整图片解码。
  const paddedImage = Buffer.alloc(limit + 1);
  PNG.copy(paddedImage);
  const chunk = Buffer.alloc(64 * 1024);
  const firstChunk = Buffer.from(chunk);
  PNG.copy(firstChunk);
  let current;
  let transfer;
  const f = await fixture(t, (call, origin, res) => {
    if (call.method === "POST") return json({ data: [current.transport === "base64"
      ? { b64_json: paddedImage.subarray(0, current.size).toString("base64") }
      : { url: `${origin}/large.png` }] });
    const state = { sent: 0, cancelled: false };
    let closed;
    state.closed = new Promise((resolve) => { closed = resolve; });
    transfer = state;
    const stream = Readable.from((function* () {
      for (let offset = 0; offset < current.size; offset += chunk.length) {
        const part = (offset === 0 ? firstChunk : chunk).subarray(0, Math.min(chunk.length, current.size - offset));
        state.sent += part.length;
        yield part;
      }
    })(), { objectMode: false });
    res.once("close", () => {
      state.cancelled = !res.writableFinished;
      stream.destroy();
      closed();
    });
    res.writeHead(200, { "content-type": "image/png" });
    stream.pipe(res); // 不发送 Content-Length，依靠实际读取的字节数判断上限。
    return null;
  });
  for (current of [
    { transport: "base64", size: limit },
    { transport: "base64", size: limit + 1 },
    { transport: "url", size: limit },
    { transport: "url", size: 64 * 1024 * 1024 },
  ]) {
    const before = f.calls.length;
    const prompt = `${current.transport} 大小边界`;
    const result = await f.run("generate", { prompt });
    if (current.size === limit) {
      await success(result, path.join(f.cwdA, "generated-images"), 1, prompt, 1, { bytes: paddedImage.subarray(0, limit) });
    } else {
      failure(result);
      assert.match(result.stderr, /25 MiB/);
    }
    assert.equal(f.calls.length - before, current.transport === "base64" ? 1 : 2);
    if (current.transport === "url") {
      await transfer.closed;
      assert.equal(transfer.cancelled, current.size > limit);
      if (current.size > limit) assert.ok(transfer.sent < current.size, "应在读完整个超限响应前断开下载");
    }
  }
  assert.equal((await readdir(path.join(f.cwdA, "generated-images"))).length, 2, "只有两个边界内结果应落盘");
});

test("下载已收到响应头但响应体停顿时仍会超时，不保存或重试", async (t) => {
  const f = await fixture(t, (call, origin, res) => {
    if (call.method === "POST") return json({ data: [{ url: `${origin}/stalled.png` }] });
    res.writeHead(200, { "content-type": "image/png" });
    res.write(PNG.subarray(0, 16));
    return null;
  }, 250);
  const result = await f.run("generate", { prompt: "下载体超时" });
  failure(result);
  assert.match(result.stderr, /下载.*超时/);
  assert.deepEqual(f.calls.map(({ method, url }) => [method, url]), [
    ["POST", "/v1/images/generations"], ["GET", "/stalled.png"],
  ]);
});

test("参考图通过 multipart 上传，保留复杂提示词且不修改原图", async (t) => {
  const f = await fixture(t);
  const imagePath = path.join(f.cwdA, "原始 参考图.png");
  await writeFile(imagePath, PNG);
  await success(await f.run("edit", {
    prompt: COMPLEX_PROMPT, imagePath, count: 2, size: "1024x1024",
  }), path.join(f.cwdA, "generated-images"), 2, COMPLEX_PROMPT);
  assert.deepEqual(await readFile(imagePath), PNG);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url, "/v1/images/edits");
  assert.match(call.headers["content-type"], /^multipart\/form-data; boundary=/);
  const form = await new Response(call.body, { headers: { "content-type": call.headers["content-type"] } }).formData();
  // FormData 的线上编码按标准将换行转换为 CRLF；CLI 返回值仍保留原始提示词。
  assert.equal(form.get("prompt"), COMPLEX_PROMPT.replaceAll("\n", "\r\n"));
  assert.equal(form.get("model"), "fake-image-model");
  assert.equal(form.get("n"), "2");
  assert.equal(form.get("size"), "1024x1024");
  assert.equal(form.has("background"), false);
  assert.equal(form.get("output_format"), "png");
  assert.equal(form.get("image").name, path.basename(imagePath));
  assert.equal(form.get("image").type, "image/png");
  assert.deepEqual(Buffer.from(await form.get("image").arrayBuffer()), PNG);
});

test("参考图编辑固定请求 PNG，仅 transparent 为 true 时请求透明背景，并原样保存半透明 RGBA", async (t) => {
  const f = await fixture(t);
  const imagePath = path.join(f.cwdA, "参考图.png");
  await writeFile(imagePath, PNG);
  const outputDir = path.join(f.cwdA, "generated-images");
  for (const [prompt, transparent] of [["透明编辑", true], ["普通编辑", false]]) {
    await success(await f.run("edit", { prompt, imagePath, transparent }), outputDir, 1, prompt);
  }
  assert.equal(f.calls.length, 2);
  const forms = await Promise.all(f.calls.map((call) => new Response(call.body, {
    headers: { "content-type": call.headers["content-type"] },
  }).formData()));
  assert.equal(forms[0].get("background"), "transparent");
  assert.equal(forms[0].get("output_format"), "png");
  assert.equal(forms[1].has("background"), false);
  assert.equal(forms[1].get("output_format"), "png");
});

test("返回少于请求张数时如实返回 requested 与 paths，并且不自动补发", async (t) => {
  const f = await fixture(t);
  await success(await f.run("generate", { prompt: "四只猫", count: 4 }), path.join(f.cwdA, "generated-images"), 4, "四只猫");
  assert.equal(f.calls.length, 1);
});

test("服务错误和无效响应明确报错，不重试或泄露密钥", async (t) => {
  const cases = [
    ...[401, 429, 404, 500].map((status) => [
      json({ error: { message: `模拟错误 ${TEST_KEY}` } }, status), new RegExp(`HTTP ${status}`),
    ]),
    [{ status: 200, headers: { "content-type": "text/html" }, body: "<html>服务异常</html>" }, /非 JSON/],
    [json({ data: [] }), /没有图片数据/],
  ];
  let response;
  const f = await fixture(t, () => response);
  for (const [reply, message] of cases) {
    response = reply;
    const before = f.calls.length;
    const result = await f.run("generate", { prompt: "不会成功" });
    failure(result);
    assert.match(result.stderr, message);
    assert.equal(f.calls.length - before, 1, "每次失败只允许一次请求");
  }
});

test("HTTP 请求超时后失败，不自动重试", async (t) => {
  const f = await fixture(t, () => null, 250);
  const result = await f.run("generate", { prompt: "超时测试" });
  failure(result);
  assert.match(result.stderr, /超时/);
  assert.equal(f.calls.length, 1);
});

test("非法 JSON、参数、参考图与 CLI 选项均在请求服务之前失败", async (t) => {
  const f = await fixture(t);
  const unsupportedImage = path.join(f.dir, "参考图.txt");
  const validImage = path.join(f.dir, "参考图.png");
  await writeFile(unsupportedImage, PNG);
  await writeFile(validImage, PNG);
  const invalid = [
    ["generate", "{ invalid JSON"],
    ["generate", null],
    ["generate", { prompt: "" }],
    ...[0, 5, 1.5, "2"].map((count) => ["generate", { prompt: "x", count }]),
    ["generate", { prompt: "x", size: 1024 }],
    ...[null, 1, "true", [], {}].flatMap((transparent) => [
      ["generate", { prompt: "x", transparent }],
      ["edit", { prompt: "x", imagePath: validImage, transparent }],
    ]),
    ["edit", { prompt: "x", imagePath: "relative.png" }],
    ["edit", { prompt: "x", imagePath: path.join(f.dir, "missing.png") }],
    ["edit", { prompt: "x", imagePath: unsupportedImage }],
  ];
  for (const [command, input] of invalid) failure(await f.run(command, input));
  for (const args of [[], ["unknown"], ["generate"], ["generate", "--input"], ["generate", "--unknown"]]) {
    failure(await f.invoke(args));
  }
  failure(await f.invoke(["generate", "--input", path.join(f.dir, "missing.json")]));
  assert.equal(f.calls.length, 0, "非法输入不得调用 HTTP 服务");
});

test("Images 同批图片保存中途失败时保留第一张路径", async (t) => {
  const f = await fixture(t, (call, origin) => json({ data: [
    { b64_json: PNG_B64 }, { b64_json: "!!!invalid-base64!!!" }, { url: `${origin}/must-not-download.png` },
  ] }));
  await partialFailure(await f.run("generate", { prompt: "保存中途失败", count: 3 }), path.join(f.cwdA, "generated-images"), 3, "保存中途失败");
  assert.equal(f.calls.length, 1);
});

test("Images 后续图片下载失败时保留已保存路径，不重新生成", async (t) => {
  const f = await fixture(t, (call, origin) => call.url === "/missing.png"
    ? json({ error: "图片下载失败" }, 500)
    : json({ data: [{ b64_json: PNG_B64 }, { url: `${origin}/missing.png` }, { url: `${origin}/must-not-download.png` }] }));
  await partialFailure(await f.run("generate", { prompt: "保留已下载图片", count: 3 }), path.join(f.cwdA, "generated-images"), 3, "保留已下载图片");
  assert.deepEqual(f.calls.map(({ method, url }) => [method, url]), [
    ["POST", "/v1/images/generations"], ["GET", "/missing.png"],
  ]);
});
