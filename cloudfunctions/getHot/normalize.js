function absLink(link) {
  const text = String(link == null ? '' : link).trim();
  if (!text) return '';
  if (text.indexOf('//') === 0) return 'https:' + text;
  return text;
}

function parseHotBody(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error('响应非 JSON');
  }
  if (!raw || raw.status !== 100000) {
    throw new Error('接口 status=' + (raw && raw.status) + ' ' + ((raw && raw.message) || ''));
  }
  if (!Array.isArray(raw.data)) {
    throw new Error('接口返回空分组');
  }
  return raw;
}

function normalize(groups, maxPerCat) {
  const limit = maxPerCat > 0 ? maxPerCat : 30;
  return (groups || []).map((g, gi) => ({
    groupId: g.id,
    groupName: g.name || '',
    sort: gi,
    categories: (g.data || []).map((c) => {
      const items = [];
      (c.data || []).forEach((row) => {
        const title = String((row && row.title) || '').trim();
        if (!title) return;
        items.push({
          id: row.id,
          title: title,
          extra: (row && row.extra) || '',
          link: absLink(row && row.link)
        });
      });
      return {
        key: c.source_key || '',
        name: c.name || '',
        iconColor: c.icon_color || '#999999',
        items: items.slice(0, limit)
      };
    })
  }));
}

module.exports = { normalize, parseHotBody, absLink };
