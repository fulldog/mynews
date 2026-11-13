/**
 * 构建期抓取：momoyu 热榜 -> miniprogram/data/hot.js
 *
 * 用法：
 *   node scripts/build-data.js
 *   MAX_PER_CAT=20 node scripts/build-data.js     # 控制每类目条数，压体积
 *
 * 产物是小程序包内静态模块，发版后生效；运行时不会再请求接口。
 * 想让内容"活"起来，配合云函数 getHot（无数据库）+ 本地缓存，见 utils/data-source.js。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { normalize, parseHotBody } = require('../cloudfunctions/fetchNews/normalize');

const API = 'https://momoyu.cc/api/hot/list?type=1';
const ORIGIN = 'https://momoyu.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_PER_CAT = Number(process.env.MAX_PER_CAT) || 30;
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'data');
const OUT_FILE = path.join(OUT_DIR, 'hot.js');

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
      timeout: timeout || 10000
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
      if (i < max) await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw lastErr;
}

(async () => {
  const t0 = Date.now();
  console.log('[build-data] 抓取 ' + API);

  const raw = await fetchWithRetry(3);
  const groups = normalize(raw.data, MAX_PER_CAT);

  if (!groups.length) throw new Error('归一化后没有任何分组，已中止（不覆盖旧文件）');

  const itemCount = groups.reduce((sum, g) => (
    sum + g.categories.reduce((inner, c) => inner + c.items.length, 0)
  ), 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: API,
    maxPerCat: MAX_PER_CAT,
    groups: groups
  };

  // 紧凑 JSON：不缩进，控制包体积
  const code = [
    '/* 由 scripts/build-data.js 自动生成，勿手动修改。',
    ' * 生成时间：' + payload.generatedAt,
    ' * 数据源：' + API + '（每类目最多 ' + MAX_PER_CAT + ' 条）',
    ' */',
    'module.exports = ' + JSON.stringify(payload) + ';',
    ''
  ].join('\n');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, code, 'utf8');

  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log('[build-data] 分组 ' + groups.length + ' / 类目 ' +
    groups.reduce((s, g) => s + g.categories.length, 0) + ' / 条目 ' + itemCount);
  console.log('[build-data] 已写入 ' + OUT_FILE + '  (' + kb + ' KB, 耗时 ' + (Date.now() - t0) + 'ms)');
  groups.forEach((g) => {
    console.log('  - ' + g.groupName + '：' + g.categories.map((c) => c.name + '(' + c.items.length + ')').join('、'));
  });
})().catch((err) => {
  console.error('[build-data] 失败：' + (err && err.message));
  process.exit(1);
});
