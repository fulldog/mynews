const config = require('./config');
const { readableColor } = require('./link');

function sortGroups(groups) {
  return (groups || []).slice().sort((a, b) => {
    const as = a.sort != null ? Number(a.sort) : Number(a.groupId);
    const bs = b.sort != null ? Number(b.sort) : Number(b.groupId);
    return as - bs;
  });
}

/** 配了图片或跳转才算一条广告。占位文案不算。 */
function isAdReady(slot) {
  if (!slot) return false;
  return !!(String(slot.image || '').trim() || String(slot.path || '').trim());
}

/**
 * 组装首页渲染序列。广告按全局类目序号插入，不写回分组文档。
 * 每隔 adInterval 个类目插一块；最后一类目后面不放，避免页面以广告收尾。
 * 该位置没有配好的广告则跳过，不留空位。
 */
function buildBlocks(groups, adSlots) {
  const ordered = sortGroups(groups);
  const blocks = [];
  const anchors = [];
  let totalCats = 0;
  ordered.forEach((g) => {
    totalCats += (g.categories || []).length;
  });

  let catIndex = 0;
  ordered.forEach((g) => {
    const gid = String(g.groupId);
    anchors.push({ gid: gid, name: g.groupName || '' });
    blocks.push({
      type: 'group',
      key: 'g-' + gid,
      gid: gid,
      name: g.groupName || ''
    });

    (g.categories || []).forEach((c) => {
      catIndex += 1;
      const items = c.items || [];
      blocks.push({
        type: 'cat',
        key: 'c-' + gid + '-' + catIndex,
        gid: gid,
        catKey: c.key || '',
        name: c.name || '',
        iconColor: readableColor(c.iconColor),
        total: items.length,
        items: items.slice(0, config.pageSize)
      });

      const isLast = catIndex === totalCats;
      if (catIndex % config.adInterval === 0 && !isLast) {
        const slotNo = catIndex / config.adInterval;
        const slots = adSlots || config.adSlots || [];
        const slot = slots.length ? slots[(slotNo - 1) % slots.length] : null;
        if (isAdReady(slot)) {
          blocks.push({
            type: 'ad',
            key: 'ad-' + catIndex,
            slotId: 'ad-' + slotNo,
            tag: slot.tag || '广告',
            title: slot.title || '',
            desc: slot.desc || '',
            image: slot.image || '',
            path: slot.path || ''
          });
        }
      }
    });
  });

  return { blocks: blocks, anchors: anchors };
}

module.exports = { buildBlocks, isAdReady };
