// web-search 技能脚本：用 DuckDuckGo 网页版搜索，把前 N 条结果打印到标准输出。
//   用法: node search.cjs "查询词" [条数=5]
//   依赖: 仅 Node.js 内置模块（http/https/url），无第三方依赖。Node 14+ 即可。
//   扩展名用 .cjs 强制 CommonJS——避免撞上项目 package.json 的 "type":"module"。
// 由桌宠 agent 经 run_command 调用；输出直接回喂给模型。
//
// 代理：若设置了环境变量 HTTPS_PROXY / HTTP_PROXY，脚本用 CONNECT 隧道走该代理
// （很多机器访问外网需要代理）；没设则直连。不依赖 Node 的 fetch/undici/启动开关。

const http = require("http");
const https = require("https");
const { URL } = require("url");

const query = process.argv[2];
const max = Math.max(1, Math.min(20, parseInt(process.argv[3] || "5", 10) || 5));
const TIMEOUT_MS = 15000;

if (!query || !query.trim()) {
  console.error('用法: node search.cjs "查询词" [条数]');
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GET 一个 https URL，resolve 成 { status, body }；有 HTTPS_PROXY/HTTP_PROXY 时走
// CONNECT 隧道。全程带超时看门狗 + 各环节 error 监听——任何卡住/断连都 reject 成
// 友好错误，绝不永久挂起（脚本被 run_command 同步等待，挂起会拖死整个工具调用）。
function httpsGet(targetUrl) {
  const target = new URL(targetUrl);
  const headers = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" };
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(v);
    };
    const abort = (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      reject(new Error(msg));
    };
    // 兜底看门狗：任何环节到点还没结果就报超时（覆盖 TLS 握手中途卡住、代理建好
    // 隧道后不转发、响应传一半停住等所有「永不 settle」的情形）
    const watchdog = setTimeout(() => abort("请求超时（网络慢或代理无响应）"), TIMEOUT_MS);

    const collect = (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => finish({ status: res.statusCode || 0, body: data }));
      res.on("error", (e) => abort("读取响应出错：" + e.message));
    };

    const sendGet = (extra) => {
      const req = https.request(
        {
          host: target.hostname,
          port: 443,
          path: target.pathname + target.search,
          method: "GET",
          headers,
          servername: target.hostname, // 隧道 socket 上仍要正确 SNI，否则证书校验失败
          ...extra,
        },
        collect,
      );
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("请求超时")));
      req.on("error", (e) => abort("请求失败：" + e.message));
      req.end();
    };

    if (proxy) {
      const p = new URL(proxy);
      const connectReq = http.request({
        host: p.hostname,
        port: p.port || 80,
        method: "CONNECT",
        path: `${target.hostname}:443`,
        headers: { Host: `${target.hostname}:443` },
      });
      connectReq.setTimeout(TIMEOUT_MS, () => connectReq.destroy(new Error("连接代理超时")));
      connectReq.on("connect", (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          abort("代理拒绝建立隧道（状态 " + res.statusCode + "）");
          return;
        }
        socket.on("error", (e) => abort("隧道 socket 出错：" + e.message)); // 中途断连走友好错误
        sendGet({ socket, agent: false });
      });
      connectReq.on("error", (e) => abort("连接代理失败：" + e.message));
      connectReq.end();
    } else {
      sendGet({});
    }
  });
}

// 去 HTML 标签 + 常见实体转义，压平空白。
// 实体解码顺序讲究：命名/数字实体先解，&amp; 最后解——否则字面量 &amp;#39; 会被
// 二次解码（先 &amp;→& 得 &#39;，再被数字实体规则解成 '），把本应保留的文本弄错。
function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// DDG 结果链接是跳转形式 //duckduckgo.com/l/?uddg=<编码后的真实URL>&...，还原真实 URL
function realUrl(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

// 广告结果：href 走 duckduckgo 的 y.js 跳转、带 ad_domain/ad_provider——跳过
function isAd(href) {
  return /duckduckgo\.com\/y\.js|[?&]ad_(domain|provider)=/.test(href);
}

async function main() {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  let status, html;
  try {
    ({ status, body: html } = await httpsGet(url));
  } catch (e) {
    console.error("搜索请求失败（网络不通或需要代理）：" + (e && e.message ? e.message : e));
    process.exit(1);
  }

  // 反爬识别：DDG 限流/要求人机验证时会回非 200（常见 202）+ anomaly-modal 挑战页
  // （无任何 result__a）。必须和「真·无结果」区分开——否则会误报「搜不到」误导模型。
  if (
    status !== 200 ||
    /anomaly-modal|Please complete the following challenge|bots use DuckDuckGo/i.test(html)
  ) {
    console.error(
      "被 DuckDuckGo 限流或要求人机验证（HTTP " +
        status +
        "）。这不是「无结果」——请稍后重试，或换用其它网络/代理。",
    );
    process.exit(1);
  }

  // 每个结果块含一个 result__a（标题+链接）与一个 result__snippet（摘要），按序配对
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const links = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    links.push({ href: m[1], title: stripTags(m[2]) });
  }
  const snippets = [];
  while ((m = snipRe.exec(html)) !== null) {
    snippets.push(stripTags(m[1]));
  }

  // 先按下标配对，再滤掉广告，最后取前 max 条（滤广告放在配对之后，不错位）。
  // 广告链接是 /l/?uddg=<编码后的 y.js 跳转> 形式，须先解码成真实 URL 再判广告
  const results = [];
  for (let i = 0; i < links.length && results.length < max; i++) {
    const u = realUrl(links[i].href);
    if (isAd(u)) continue;
    results.push({ title: links[i].title, url: u, snippet: snippets[i] || "" });
  }

  if (results.length === 0) {
    console.log("（没有搜到结果，可换个措辞重试）");
    return;
  }

  console.log(
    results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n"),
  );
}

main();
