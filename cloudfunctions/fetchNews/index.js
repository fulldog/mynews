/**
 * 抓取 momoyu 热榜，归一化后按组覆盖写入云数据库。
 * 失败只记 snapshot，不改 groups 里的旧数据。
 *
 * 环境变量（云开发控制台配置，不配则用默认值）：
 *   FETCH_INTERVAL_MIN  成功后的最短间隔，默认 5
 *   MAX_PER_CAT         每个类目最多保留条数，默认 30
 * 手动全量抓取可传 { force: true }，忽略间隔和退避。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { normalize, parseHotBody } = require('./normalize');
const { shouldSkip } = require('./skip');
const { withRetry } = require('./retry');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const API = 'https://momoyu.cc/api/hot/list?type=1';
const ORIGIN = 'https://momoyu.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADER_KEYS = ['date', 'content-type', 'content-length', 'etag', 'server'];

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const INTERVAL_MIN = numEnv('FETCH_INTERVAL_MIN', 5);
const MAX_PER_CAT = Math.min(numEnv('MAX_PER_CAT', 30), 100);

function pickHeaders(headers) {
  const out = {};
  HEADER_KEYS.forEach((key) => {
    if (headers && headers[key]) out[key] = String(headers[key]).slice(0, 180);
  });
  return out;
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = https.get(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': UA,
        Referer: ORIGIN + '/'
      },
      timeout: 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers || {},
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      fail(new Error('请求超时'));
    });
    req.on('error', (err) => fail(err));
  });
}

async function fetchHot() {
  return withRetry(async () => {
    const got = await requestOnce(API);
    const meta = {
      httpStatus: got.statusCode,
      headers: pickHeaders(got.headers)
    };
    if (got.statusCode !== 200) {
      const err = new Error('HTTP ' + got.statusCode);
      err.meta = meta;
      throw err;
    }
    try {
      return { raw: parseHotBody(got.body), meta: meta };
    } catch (err) {
      err.meta = meta;
      throw err;
    }
  }, 2);
}

function stamp(row) {
  const at = row && row.at;
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadRecent() {
  const res = await db.collection('snapshot').orderBy('at', 'desc').limit(8).get();
  return (res.data || []).map((row) => ({
    ok: !!row.ok,
    at: stamp(row)
  })).filter((row) => row.at);
}

async function writeSnapshot(payload) {
  try {
    await db.collection('snapshot').add({
      data: Object.assign({ at: db.serverDate() }, payload)
    });
  } catch (err) {
    console.warn('[snapshot 写入失败]', err && err.message);
  }
}

exports.main = async (event) => {
  const t0 = Date.now();
  const force = !!(event && (event.force === true || event.force === 1 || event.force === '1'));

  if (!force) {
    try {
      const decision = shouldSkip(await loadRecent(), Date.now(), INTERVAL_MIN);
      if (decision) {
        return {
          ok: true,
          skipped: true,
          reason: decision.reason,
          groups: 0,
          items: 0,
          cost: Date.now() - t0
        };
      }
    } catch (err) {
      console.warn('[读取 snapshot 失败，继续抓取]', err && err.message);
    }
  }

  try {
    const fetched = await fetchHot();
    const groups = normalize(fetched.raw.data, MAX_PER_CAT);
    if (!groups.length) {
      const err = new Error('接口返回空分组');
      err.meta = fetched.meta;
      throw err;
    }

    const itemCount = groups.reduce((sum, g) => (
      sum + g.categories.reduce((inner, c) => inner + c.items.length, 0)
    ), 0);

    await Promise.all(groups.map((g) => db.collection('groups').doc(String(g.groupId)).set({
      data: {
        groupId: g.groupId,
        groupName: g.groupName,
        sort: g.sort,
        categories: g.categories,
        updatedAt: db.serverDate()
      }
    })));

    const cost = Date.now() - t0;
    await writeSnapshot({
      ok: true,
      groups: groups.length,
      items: itemCount,
      cost: cost,
      httpStatus: fetched.meta.httpStatus,
      headers: fetched.meta.headers
    });
    return { ok: true, groups: groups.length, items: itemCount, cost: cost };
  } catch (err) {
    const cost = Date.now() - t0;
    const meta = (err && err.meta) || {};
    await writeSnapshot({
      ok: false,
      error: String((err && err.message) || err),
      cost: cost,
      httpStatus: meta.httpStatus || 0,
      headers: meta.headers || {}
    });
    console.error('[fetchNews 失败]', err);
    return { ok: false, error: String((err && err.message) || err), cost: cost };
  }
};
