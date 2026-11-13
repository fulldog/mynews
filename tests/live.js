/**
 * 对线上热榜跑一遍归一化和首页组装。node tests/live.js
 */
const https = require('https');
const assert = require('assert');
const { normalize, parseHotBody } = require('../cloudfunctions/fetchNews/normalize');
const { buildBlocks, isAdReady } = require('../miniprogram/utils/blocks');
const config = require('../miniprogram/utils/config');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://momoyu.cc/'
      },
      timeout: 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
  });
}

(async () => {
  const res = await get('https://momoyu.cc/api/hot/list?type=1');
  assert.strictEqual(res.statusCode, 200);
  const raw = parseHotBody(res.body);
  const rawCats = raw.data.reduce((sum, g) => sum + (g.data || []).length, 0);
  const groups = normalize(raw.data, 30);
  const cats = groups.reduce((sum, g) => sum + g.categories.length, 0);
  const items = groups.reduce((sum, g) => (
    sum + g.categories.reduce((inner, c) => inner + c.items.length, 0)
  ), 0);

  assert.strictEqual(groups.length, 6, '分组数');
  assert.strictEqual(cats, rawCats, '类目数与上游一致');
  assert.ok(cats >= 13, '至少 13 个类目');

  groups.forEach((g) => {
    g.categories.forEach((c) => {
      assert.ok(c.items.length <= 30, c.key + ' 超过 30 条');
      c.items.forEach((item) => {
        assert.ok(item.title, '空标题');
        assert.ok(!item.link || /^https?:\/\//.test(item.link), item.link);
      });
    });
  });

  const bili = groups.reduce((found, g) => found || g.categories.find((c) => c.key === 'bilibili'), null);
  const biliRaw = raw.data.reduce((found, g) => (
    found || (g.data || []).find((c) => c.source_key === 'bilibili')
  ), null);
  if (biliRaw && (biliRaw.data || []).length > 30) {
    assert.strictEqual(bili.items.length, 30);
  }

  const { blocks } = buildBlocks(groups);
  const catBlocks = blocks.filter((b) => b.type === 'cat');
  const ads = blocks.filter((b) => b.type === 'ad');
  assert.strictEqual(catBlocks.length, cats);
  const slots = config.adSlots || [];
  let expectedAds = 0;
  for (let i = 1; i <= cats; i += 1) {
    if (i % config.adInterval !== 0 || i === cats) continue;
    const slotNo = i / config.adInterval;
    const slot = slots.length ? slots[(slotNo - 1) % slots.length] : null;
    if (isAdReady(slot)) expectedAds += 1;
  }
  assert.strictEqual(ads.length, expectedAds);
  catBlocks.forEach((block) => {
    assert.ok(block.items.length <= 10);
  });

  console.log(JSON.stringify({ groups: groups.length, cats: cats, items: items, ads: ads.length }));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
