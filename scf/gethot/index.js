/**
 * SCF Web函数版（腾讯云独立云函数，非微信云开发）
 *
 * 抓 momoyu 热榜，以 HTTP JSON 返回。无数据库：实例内存缓存 TTL 5 分钟。
 * 腾讯云 SCF「Web函数」要求进程自行监听端口（默认 9000，可用环境变量 PORT 覆盖）。
 *
 * 部署：把 index.js / normalize.js / token.js / package.json 一起上传（在线编辑或 zip）。
 * 环境变量 TOKEN 必须与小程序 config.token 一致，否则返回 401。
 * 验证：函数 URL 加 ?token=... 应返回 {"ok":true,"groups":[...]}。
 */
const http = require('http');
const https = require('https');
const { normalize, parseHotBody } = require('./normalize');
const { tokensMatch } = require('./token');

const PORT = Number(process.env.PORT || 9000);
const API = 'https://momoyu.cc/api/hot/list?type=1';
const ORIGIN = 'https://momoyu.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TTL_MS = numEnv('CACHE_TTL_MIN', 5) * 60 * 1000;
const MAX_PER_CAT = Math.min(numEnv('MAX_PER_CAT', 30), 100);

// 实例级缓存，进程存活期间有效
let cache = { at: 0, groups: null, fetching: null };

function requestOnce(url, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const req = https.get(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': UA,
        Referer: ORIGIN + '/'
      },
      timeout: timeout || 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve, {
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => { req.destroy(); done(reject, new Error('请求超时')); });
    req.on('error', (err) => done(reject, err));
  });
}

async function fetchWithRetry(attempts) {
  const max = attempts || 3;
  let lastErr;
  for (let i = 1; i <= max; i += 1) {
    try {
      const got = await requestOnce(API);
      if (got.statusCode !== 200) throw new Error('HTTP ' + got.statusCode);
      return parseHotBody(got.body);
    } catch (err) {
      lastErr = err;
      if (i < max) await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw lastErr;
}

/** 缓存过期后只允许一个回源请求，其余等待同一结果（防并发击穿） */
function getGroups(force) {
  const now = Date.now();
  if (!force && cache.groups && now - cache.at < TTL_MS) {
    return Promise.resolve({
      ok: true, groups: cache.groups, at: cache.at,
      from: 'memory', cached: true, count: countItems(cache.groups)
    });
  }
  if (cache.fetching) return cache.fetching;

  cache.fetching = (async () => {
    try {
      const raw = await fetchWithRetry(3);
      const groups = normalize(raw.data, MAX_PER_CAT);
      if (!groups.length) throw new Error('接口返回空分组');
      cache.at = Date.now();
      cache.groups = groups;
      return {
        ok: true, groups: groups, at: cache.at,
        from: 'remote', cached: false, count: countItems(groups)
      };
    } catch (err) {
      if (cache.groups) {
        return {
          ok: true, groups: cache.groups, at: cache.at,
          from: 'memory-stale', cached: true, stale: true,
          error: String((err && err.message) || err),
          count: countItems(cache.groups)
        };
      }
      throw err;
    } finally {
      cache.fetching = null;
    }
  })();
  return cache.fetching;
}

function countItems(groups) {
  return groups.reduce((s, g) => s + g.categories.reduce((a, c) => a + c.items.length, 0), 0);
}

function expectedToken() {
  return process.env.TOKEN || process.env.token || '';
}

function reject401(res) {
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, code: 401, error: 'unauthorized', groups: [] }));
}

const server = http.createServer((req, res) => {
  let force = false;
  let token = '';
  try {
    const u = new URL(req.url, 'http://localhost');
    force = u.searchParams.get('force') === '1';
    token = u.searchParams.get('token') || '';
  } catch (err) {
    reject401(res);
    return;
  }

  if (!tokensMatch(token, expectedToken())) {
    reject401(res);
    return;
  }

  getGroups(force)
    .then((out) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    })
    .catch((err) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err), groups: [] }));
    });
});

server.listen(PORT, () => {
  console.log('[gethot] listening on ' + PORT + '  cacheTTL=' + (TTL_MS / 60000) + 'min  maxPerCat=' + MAX_PER_CAT);
});
