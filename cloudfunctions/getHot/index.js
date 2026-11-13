/**
 * getHot —— 无数据库版取数函数
 *
 * 抓 momoyu 热榜后直接返回给小程序，不写库、不依赖 wx-server-sdk。
 * 模块级内存缓存：同一函数实例在 TTL 内复用结果，回源频率与用户量无关。
 * 冷启动/实例回收后首次调用会回源一次（约 200-600ms）。
 *
 * 可选入参：{ force: true } 忽略内存缓存强制回源
 * 环境变量 TOKEN 必须与入参 token 一致，否则返回 401。
 */
const https = require('https');
const { normalize, parseHotBody } = require('./normalize');
const { tokensMatch } = require('./token');

const API = 'https://momoyu.cc/api/hot/list?type=1';
const ORIGIN = 'https://momoyu.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TTL_MS = numEnv('CACHE_TTL_MIN', 5) * 60 * 1000;
const MAX_PER_CAT = Math.min(numEnv('MAX_PER_CAT', 30), 100);

// 实例级缓存，函数实例存活期间有效
let cache = { at: 0, groups: null };

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

exports.main = async (event) => {
  const t0 = Date.now();
  const got = event && (event.token || (event.queryStringParameters && event.queryStringParameters.token));
  if (!tokensMatch(got, process.env.TOKEN || process.env.token || '')) {
    return { ok: false, code: 401, error: 'unauthorized', groups: [], cost: Date.now() - t0 };
  }

  const force = !!(event && (event.force === true || event.force === '1' || event.force === 1));
  const now = Date.now();

  if (!force && cache.groups && now - cache.at < TTL_MS) {
    return {
      ok: true,
      groups: cache.groups,
      at: cache.at,
      from: 'memory',
      cached: true,
      cost: Date.now() - t0
    };
  }

  try {
    const raw = await fetchWithRetry(3);
    const groups = normalize(raw.data, MAX_PER_CAT);
    if (!groups.length) throw new Error('接口返回空分组');

    cache = { at: Date.now(), groups: groups };
    return {
      ok: true,
      groups: groups,
      at: cache.at,
      from: 'remote',
      cached: false,
      cost: Date.now() - t0
    };
  } catch (err) {
    // 抓取失败但手里有旧数据：返回旧数据，别让页面白屏
    if (cache.groups) {
      return {
        ok: true,
        groups: cache.groups,
        at: cache.at,
        from: 'memory-stale',
        cached: true,
        stale: true,
        error: String((err && err.message) || err),
        cost: Date.now() - t0
      };
    }
    console.error('[getHot 失败]', err);
    return {
      ok: false,
      groups: [],
      error: String((err && err.message) || err),
      cost: Date.now() - t0
    };
  }
};
