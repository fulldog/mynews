const crypto = require('crypto');

/** 与环境变量逐字节比较。空值、长度不同都算不通过。 */
function tokensMatch(got, expected) {
  const a = Buffer.from(String(got == null ? '' : got));
  const b = Buffer.from(String(expected == null ? '' : expected));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { tokensMatch };
