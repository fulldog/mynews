function absLink(link) {
  const text = String(link == null ? '' : link).trim();
  if (!text) return '';
  if (text.indexOf('//') === 0) return 'https:' + text;
  return text;
}

/** 浅色图标在白底上看不见，换成中性灰。 */
function readableColor(input) {
  let hex = String(input || '').trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(hex);
  if (short) {
    hex = '#' + short[1].split('').map((ch) => ch + ch).join('');
  }
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return '#999999';
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance > 0.82) return '#999999';
  return '#' + match[1];
}

module.exports = { absLink, readableColor };
