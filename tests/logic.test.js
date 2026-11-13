/**
 * 纯逻辑验收。node tests/logic.test.js
 * 不依赖微信开发者工具，也不依赖云环境。
 */
const assert = require('assert');
const config = require('../miniprogram/utils/config');
const { buildBlocks, isAdReady } = require('../miniprogram/utils/blocks');
const { absLink, readableColor } = require('../miniprogram/utils/link');
const { openWith } = require('../miniprogram/utils/open');
const { normalize, parseHotBody } = require('../cloudfunctions/fetchNews/normalize');
const { shouldSkip } = require('../cloudfunctions/fetchNews/skip');
const { withRetry } = require('../cloudfunctions/fetchNews/retry');
const { shouldFetchOnOpen, applyRead, readKey } = require('../miniprogram/utils/news-policy');
const { tokensMatch } = require('../scf/gethot/token');

let passed = 0;

function check(name, fn) {
  return function () {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log('  ok  ' + name);
      })
      .catch((err) => {
        console.error('  FAIL ' + name);
        console.error(err && err.stack || err);
        process.exitCode = 1;
      });
  };
}

function makeGroups(counts) {
  return counts.map((n, gi) => ({
    groupId: gi + 1,
    groupName: '组' + (gi + 1),
    sort: gi,
    categories: Array.from({ length: n }, (_, ci) => ({
      key: 'k' + gi + '_' + ci,
      name: '类' + gi + '-' + ci,
      iconColor: gi === 0 && ci === 0 ? '#fff' : '#0177D7',
      items: Array.from({ length: 12 }, (_, i) => ({
        id: gi * 1000 + ci * 50 + i,
        title: '标题' + i,
        extra: i % 2 ? '1万' : '',
        link: 'https://example.com/' + i
      }))
    }))
  }));
}

function typesOf(blocks) {
  return blocks.map((b) => b.type).join(' ');
}

function mockWx() {
  const calls = [];
  global.wx = {
    showToast(opt) { calls.push({ type: 'toast', title: opt.title }); },
    hideToast() { calls.push({ type: 'hideToast' }); },
    showModal(opt) {
      calls.push({ type: 'modal', title: opt.title });
      if (opt.complete) opt.complete();
    },
    setClipboardData(opt) {
      calls.push({ type: 'copy', data: opt.data });
      if (opt.success) opt.success();
    },
    navigateToMiniProgram(opt) {
      calls.push({ type: 'mp', appId: opt.appId, path: opt.path || '' });
      if (opt.success) opt.success();
    }
  };
  return calls;
}

const jobs = [];

jobs.push(check('首页条数与广告间隔按计划固定', () => {
  assert.strictEqual(config.pageSize, 10);
  assert.strictEqual(config.adInterval, 2);
  assert.strictEqual(config.adSlots.length, 4);
}));

const readyAds = [
  { tag: '广告', title: '甲', image: 'https://example.com/a.png', path: '/pages/a' },
  { tag: '广告', title: '乙', image: '', path: '/pages/b' },
  { tag: '广告', title: '丙', image: 'https://example.com/c.png', path: '' },
  { tag: '广告', title: '丁', image: 'https://example.com/d.png', path: '/pages/d' }
];

jobs.push(check('13 个类目在第 2、4、6、8、10、12 个之后各插 1 个广告，末尾不插', () => {
  const { blocks, anchors } = buildBlocks(makeGroups([4, 3, 2, 2, 1, 1]), readyAds);
  assert.strictEqual(anchors.length, 6);
  assert.strictEqual(
    typesOf(blocks),
    'group cat cat ad cat cat ad group cat cat ad cat group cat ad cat group cat ad cat group cat ad group cat'
  );
  const ads = blocks.filter((b) => b.type === 'ad');
  assert.deepStrictEqual(ads.map((a) => a.slotId), ['ad-1', 'ad-2', 'ad-3', 'ad-4', 'ad-5', 'ad-6']);
  assert.strictEqual(blocks[blocks.length - 1].type, 'cat');
}));

jobs.push(check('没配图片和跳转的广告位不占位', () => {
  assert.strictEqual(isAdReady({ title: '广告位 1', image: '', path: '' }), false);
  assert.strictEqual(isAdReady({ image: 'https://example.com/a.png' }), true);
  assert.strictEqual(isAdReady({ path: '/pages/a' }), true);
  const { blocks } = buildBlocks(makeGroups([4, 3, 2, 2, 1, 1]), config.adSlots);
  assert.strictEqual(blocks.some((b) => b.type === 'ad'), false);
}));

jobs.push(check('单个广告位没配好时只藏这一位', () => {
  const slots = [
    { title: '空', image: '', path: '' },
    { title: '乙', image: '', path: '/pages/b' },
    { title: '空', image: '', path: '' },
    { title: '丁', image: 'https://example.com/d.png', path: '' }
  ];
  const { blocks } = buildBlocks(makeGroups([4, 3, 2, 2, 1, 1]), slots);
  const ads = blocks.filter((b) => b.type === 'ad');
  assert.deepStrictEqual(ads.map((a) => a.slotId), ['ad-2', 'ad-4', 'ad-6']);
  assert.deepStrictEqual(ads.map((a) => a.title), ['乙', '丁', '乙']);
}));

jobs.push(check('广告按全局类目计数，不按分组重新计数', () => {
  const { blocks } = buildBlocks(makeGroups([2, 2]), readyAds);
  assert.strictEqual(typesOf(blocks), 'group cat cat ad group cat cat');
}));

jobs.push(check('类目块只放 Top 10，总数仍是全量，且不改原始数据', () => {
  const groups = makeGroups([1]);
  const before = JSON.stringify(groups);
  const { blocks } = buildBlocks(groups);
  const cat = blocks.find((b) => b.type === 'cat');
  assert.strictEqual(cat.items.length, 10);
  assert.strictEqual(cat.total, 12);
  assert.strictEqual(cat.items[0].title, '标题0');
  assert.strictEqual(JSON.stringify(groups), before);
}));

jobs.push(check('浅色类目点改成可见颜色，分组按 sort 排', () => {
  const groups = makeGroups([1, 1]).reverse();
  const { blocks, anchors } = buildBlocks(groups);
  assert.deepStrictEqual(anchors.map((a) => a.name), ['组1', '组2']);
  assert.strictEqual(blocks.find((b) => b.type === 'cat').iconColor, '#999999');
  assert.strictEqual(readableColor('#0177D7'), '#0177D7');
  assert.strictEqual(readableColor('#A3A3A3'), '#A3A3A3');
  assert.strictEqual(readableColor(''), '#999999');
}));

jobs.push(check('协议相对链接补全，空链接视为没有', () => {
  assert.strictEqual(absLink('//news.zol.com.cn/a.html'), 'https://news.zol.com.cn/a.html');
  assert.strictEqual(absLink(' https://a.com/x '), 'https://a.com/x');
  assert.strictEqual(absLink(''), '');
  assert.strictEqual(absLink(null), '');
}));

jobs.push(check('归一化：截断 30 条、丢掉空标题、补全链接', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({
    id: i + 1,
    title: i === 3 ? '   ' : '条' + i,
    extra: i === 0 ? null : '热',
    link: i === 1 ? '//news.zol.com.cn/x' : 'https://example.com/' + i
  }));
  const groups = normalize([{
    id: 7,
    name: '购物平台',
    data: [{
      source_key: 'zhidemai',
      name: '值得买',
      icon_color: '#F04848',
      data: many
    }, {
      name: '缺字段'
    }]
  }], 30);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupId, 7);
  assert.strictEqual(groups[0].sort, 0);
  const cat = groups[0].categories[0];
  assert.strictEqual(cat.key, 'zhidemai');
  assert.strictEqual(cat.items.length, 30);
  assert.strictEqual(cat.items.some((it) => !String(it.title).trim()), false);
  assert.strictEqual(cat.items[1].link, 'https://news.zol.com.cn/x');
  assert.strictEqual(cat.items[0].extra, '');
  assert.strictEqual(groups[0].categories[1].key, '');
  assert.deepStrictEqual(groups[0].categories[1].items, []);
}));

jobs.push(check('接口体：成功、空分组、坏 JSON、非成功状态', () => {
  const ok = parseHotBody(JSON.stringify({ status: 100000, message: '成功', data: [] }));
  assert.deepStrictEqual(ok.data, []);
  assert.throws(() => parseHotBody('not-json'), /非 JSON/);
  assert.throws(() => parseHotBody(JSON.stringify({ status: 0, message: 'no' })), /status=0/);
  assert.throws(() => parseHotBody(JSON.stringify({ status: 100000 })), /空分组/);
}));

jobs.push(check('未到间隔或失败退避时跳过，到点则抓取', () => {
  const interval = 5;
  const min = 60 * 1000;
  assert.strictEqual(shouldSkip([], 0, interval), null);

  const fresh = shouldSkip([{ ok: true, at: 10 * min }], 14 * min, interval);
  assert.strictEqual(fresh.reason, 'interval');

  assert.strictEqual(shouldSkip([{ ok: true, at: 0 }], 5 * min, interval), null);

  const backoff = shouldSkip([
    { ok: false, at: 10 * min },
    { ok: true, at: 0 }
  ], 16 * min, interval);
  assert.strictEqual(backoff.reason, 'backoff');
  assert.strictEqual(backoff.waitMin, 10);

  assert.strictEqual(shouldSkip([
    { ok: false, at: 0 }
  ], 10 * min, interval), null);

  const capped = shouldSkip([
    { ok: false, at: 0 },
    { ok: false, at: 0 },
    { ok: false, at: 0 }
  ], 20 * min, interval);
  assert.strictEqual(capped.waitMin, 30);
}));

jobs.push(check('重试两次后仍失败就抛出最后一次错误', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(() => {
      calls += 1;
      return Promise.reject(new Error('超时'));
    }, 2, () => Promise.resolve()),
    /超时/
  );
  assert.strictEqual(calls, 3);
}));

jobs.push(check('第二次重试成功就返回结果', async () => {
  let calls = 0;
  const value = await withRetry(() => {
    calls += 1;
    if (calls < 3) return Promise.reject(new Error('临时失败'));
    return Promise.resolve('ok');
  }, 2, () => Promise.resolve());
  assert.strictEqual(value, 'ok');
  assert.strictEqual(calls, 3);
}));

jobs.push(check('无链接只提示，不复制', async () => {
  const calls = mockWx();
  const result = await openWith({ title: 'x', link: '  ' }, 'hupu', { hupu: { appId: 'wx1', path: '' } });
  assert.strictEqual(result.way, 'fail');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].title, '暂无原文链接');
}));

jobs.push(check('没配 AppID 时复制补全后的链接', async () => {
  const calls = mockWx();
  const result = await openWith(
    { title: 'x', link: '//news.zol.com.cn/a.html' },
    'zhongguancun',
    { zhongguancun: { appId: '', path: '' } }
  );
  assert.strictEqual(result.way, 'clipboard');
  assert.strictEqual(calls[0].data, 'https://news.zol.com.cn/a.html');
  assert.ok(calls.some((c) => c.type === 'modal'));
}));

jobs.push(check('配了 AppID 就跳小程序', async () => {
  const calls = mockWx();
  const result = await openWith(
    { title: 'x', link: 'https://bbs.hupu.com/1.html' },
    'hupu',
    { hupu: { appId: 'wxhupu', path: 'pages/detail' } }
  );
  assert.strictEqual(result.way, 'mp');
  assert.strictEqual(calls[0].appId, 'wxhupu');
  assert.strictEqual(calls[0].path, 'pages/detail');
}));

jobs.push(check('跳转失败退回复制链接', async () => {
  const calls = mockWx();
  global.wx.navigateToMiniProgram = (opt) => {
    calls.push({ type: 'mp' });
    opt.fail({ errMsg: 'cancel' });
  };
  const result = await openWith(
    { title: 'x', link: 'https://www.zhihu.com/question/1' },
    'zhihu',
    { zhihu: { appId: 'wxzhihu', path: '' } }
  );
  assert.strictEqual(result.way, 'clipboard');
  assert.strictEqual(calls[1].data, 'https://www.zhihu.com/question/1');
}));

jobs.push(check('首次打开或超过 10 分钟才重新请求', () => {
  const ttl = 10 * 60 * 1000;
  const t0 = 1_000_000;
  assert.strictEqual(config.cacheTTLMin, 10);
  assert.strictEqual(shouldFetchOnOpen(0, false, t0, ttl), true);
  assert.strictEqual(shouldFetchOnOpen(0, true, t0, ttl), true);
  assert.strictEqual(shouldFetchOnOpen(t0, true, t0 + ttl, ttl), false);
  assert.strictEqual(shouldFetchOnOpen(t0, true, t0 + ttl + 1, ttl), true);
  assert.strictEqual(shouldFetchOnOpen(t0, false, t0 + 1000, ttl), true);
}));

jobs.push(check('点过的资讯打上已读，且不改原始条目', () => {
  const blocks = [{
    type: 'cat',
    catKey: 'zhihu',
    items: [{ id: 7, title: '一条', extra: '1万' }]
  }, {
    type: 'ad',
    slotId: 'ad-1'
  }];
  const before = JSON.stringify(blocks);
  const map = {};
  map[readKey('zhihu', 7)] = 1;
  const painted = applyRead(blocks, map);
  assert.strictEqual(painted[0].items[0].read, true);
  assert.strictEqual(painted[0].items[0].title, '一条');
  assert.strictEqual(painted[1].type, 'ad');
  assert.strictEqual(JSON.stringify(blocks), before);
  const unread = applyRead(blocks, {});
  assert.strictEqual(unread[0].items[0].read, false);
}));

jobs.push(check('token 与环境变量不一致则不通过', () => {
  const secret = '3Loe8QRgZK3oojXnIVGpDDPr6_OsuQrR';
  assert.strictEqual(tokensMatch(secret, secret), true);
  assert.strictEqual(tokensMatch(secret + 'x', secret), false);
  assert.strictEqual(tokensMatch('wrong', secret), false);
  assert.strictEqual(tokensMatch('', secret), false);
  assert.strictEqual(tokensMatch(secret, ''), false);
  assert.strictEqual(config.token, secret);
}));

jobs.push(check('复制失败有提示', async () => {
  const calls = mockWx();
  global.wx.setClipboardData = (opt) => {
    calls.push({ type: 'copy' });
    if (opt.fail) opt.fail();
  };
  const result = await openWith({ link: 'https://example.com' }, 'weibo', {});
  assert.strictEqual(result.way, 'fail');
  assert.strictEqual(calls[calls.length - 1].title, '复制失败');
}));

jobs.reduce((chain, run) => chain.then(run), Promise.resolve()).then(() => {
  if (process.exitCode) console.error('\n失败');
  else console.log('\n' + passed + ' passed');
});
