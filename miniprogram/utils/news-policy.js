/**
 * 打开时机与已读标记。不依赖 wx，方便单测。
 * 「超过 10 分钟」按上一次打开算，不是按缓存写入时间算。
 */

function shouldFetchOnOpen(lastOpen, hasCache, now, ttlMs) {
  if (!hasCache) return true;
  const last = Number(lastOpen) || 0;
  if (!last) return true;
  return now - last > ttlMs;
}

function readKey(catKey, id) {
  return String(catKey || '') + ':' + String(id);
}

function applyRead(blocks, readMap) {
  return (blocks || []).map((block) => {
    if (!block || block.type !== 'cat') return block;
    const items = (block.items || []).map((it) => Object.assign({}, it, {
      read: !!(readMap && readMap[readKey(block.catKey, it.id)])
    }));
    return Object.assign({}, block, { items: items });
  });
}

function applyReadItems(items, catKey, readMap) {
  return (items || []).map((it) => Object.assign({}, it, {
    read: !!(readMap && readMap[readKey(catKey, it.id)])
  }));
}

module.exports = { shouldFetchOnOpen, readKey, applyRead, applyReadItems };
