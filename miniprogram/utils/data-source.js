/**
 * 取数层：三级回落，全程不碰数据库。
 *
 *   1. 本地 Storage。距离上一次打开小程序不超过 cacheTTLMin 就直接用。
 *   2. 超过 10 分钟，或本地还没有缓存（首次打开）时，调云函数 getHot。
 *   3. 云函数失败时，用旧缓存；再没有就用包内 data/hot.js。
 *
 * 未开通云开发时第 2 步会失败，页面仍能用包内数据。
 * 已读状态单独存在本地，刷新资讯不会清掉。
 */
const config = require('./config');
const bundled = require('../data/hot');
const { shouldFetchOnOpen, readKey, applyRead, applyReadItems } = require('./news-policy');

const CACHE_KEY = 'hotCache:v1';
const OPEN_KEY = 'hotLastOpen:v1';
const READ_KEY = 'hotRead:v1';
const READ_LIMIT = 800;

// 本次前台周期要不要打云函数。由 App.onShow 写入。
const session = { fetch: false, settled: false };

function safeGet(key) {
  try {
    return wx.getStorageSync(key);
  } catch (err) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    // 存储满了也不该影响主流程
  }
}

function bundledGroups() {
  return (bundled && bundled.groups) || [];
}

function bundledAt() {
  const at = Date.parse(bundled && bundled.generatedAt);
  return Number.isFinite(at) ? at : 0;
}

function readCache() {
  const c = safeGet(CACHE_KEY);
  if (c && Array.isArray(c.groups) && c.groups.length && c.at) return c;
  return null;
}

function ttlMs() {
  return (config.cacheTTLMin || 10) * 60 * 1000;
}

/**
 * 小程序进入前台时记一次「打开」。
 * 用记之前的时间判断要不要重新请求，再把打开时间更新成现在。
 */
function noteAppOpen(now) {
  const ts = now || Date.now();
  const last = Number(safeGet(OPEN_KEY)) || 0;
  const cache = readCache();
  session.fetch = shouldFetchOnOpen(last, !!cache, ts, ttlMs());
  safeSet(OPEN_KEY, ts);
  return session.fetch;
}

function shouldReload() {
  return session.fetch;
}

function readMap() {
  const list = safeGet(READ_KEY);
  const map = {};
  if (Array.isArray(list)) {
    list.forEach((key) => { map[key] = 1; });
  }
  return map;
}

function markRead(catKey, id) {
  if (id == null || id === '') return;
  const key = readKey(catKey, id);
  const list = safeGet(READ_KEY);
  const arr = Array.isArray(list) ? list.filter((item) => item !== key) : [];
  arr.push(key);
  if (arr.length > READ_LIMIT) arr.splice(0, arr.length - READ_LIMIT);
  safeSet(READ_KEY, arr);
}

/** 调微信云开发云函数；任何失败都返回 null，不抛错 */
function callCloud() {
  return new Promise((resolve) => {
    if (!wx.cloud || config.dataMode === 'static' || !config.cloudFn) return resolve(null);
    wx.cloud.callFunction({
      name: config.cloudFn,
      data: { token: config.token || '' },
      success: (res) => {
        const r = res && res.result;
        if (r && r.ok !== false && Array.isArray(r.groups) && r.groups.length) resolve(r);
        else resolve(null);
      },
      fail: () => resolve(null)
    });
  });
}

function withToken(url) {
  const token = encodeURIComponent(config.token || '');
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const suffix = hashAt >= 0 ? url.slice(hashAt) : '';
  const join = base.indexOf('?') >= 0 ? '&' : '?';
  return base + join + 'token=' + token + suffix;
}

/** 调腾讯云 SCF Web函数（HTTP）；任何失败都返回 null，不抛错 */
function callScfHttp() {
  return new Promise((resolve) => {
    if (!config.apiBase || !wx.request || config.dataMode === 'static') return resolve(null);
    wx.request({
      url: withToken(config.apiBase.replace(/\/+$/, '') + '/'),
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        const d = res.data;
        if (d && d.ok !== false && Array.isArray(d.groups) && d.groups.length) resolve(d);
        else resolve(null);
      },
      fail: () => resolve(null)
    });
  });
}

/**
 * 取分组数据
 * @param {{force?: boolean}} opts force=true 跳过前端缓存（下拉刷新用）
 * @returns {{groups: Array, from: string, at: number}}
 *   from: 'cache' | 'cloud' | 'bundle' | 'none'
 */
async function loadGroups(opts) {
  const force = !!(opts && opts.force);
  const cache = readCache();
  const remoteNeeded = force || session.fetch || (!cache && !session.settled);

  if (!remoteNeeded) {
    session.settled = true;
    if (cache) return { groups: cache.groups, from: 'cache', at: cache.at };
    const packed = bundledGroups();
    if (packed.length) return { groups: packed, from: 'bundle', at: bundledAt() };
    return { groups: [], from: 'none', at: 0 };
  }

  session.fetch = false;
  session.settled = true;

  const remote = (await callCloud()) || (await callScfHttp());
  if (remote) {
    const at = Date.now();
    safeSet(CACHE_KEY, { at: at, groups: remote.groups });
    return { groups: remote.groups, from: 'cloud', at: at };
  }

  if (cache) return { groups: cache.groups, from: 'cache', at: cache.at };

  const groups = bundledGroups();
  if (groups.length) return { groups: groups, from: 'bundle', at: bundledAt() };

  return { groups: [], from: 'none', at: 0 };
}

/** 按 groupId + 类目 key 取单类目（列表页用，不单独请求） */
async function loadCategory(gid, key) {
  const res = await loadGroups({ force: false });
  const group = (res.groups || []).find((g) => String(g.groupId) === String(gid));
  const cat = ((group && group.categories) || []).find((c) => c.key === key);
  return { cat: cat || null, from: res.from, at: res.at };
}

function formatAt(at) {
  if (!at) return '';
  const d = new Date(at);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 首页底部一行数据来源说明 */
function describeSource(from, at) {
  const time = formatAt(at);
  if (from === 'cloud') return '数据更新于 ' + time;
  if (from === 'cache') return '缓存数据 · ' + time;
  if (from === 'bundle') return '内置数据 · ' + (time || '未知') + '（发版时快照）';
  return '';
}

module.exports = {
  loadGroups,
  loadCategory,
  describeSource,
  noteAppOpen,
  shouldReload,
  markRead,
  readMap,
  applyRead,
  applyReadItems
};
