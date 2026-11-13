const BACKOFF_CAP_MIN = 30;
const SLACK_MS = 30 * 1000;

/**
 * rows 按时间倒序。成功后未满间隔、或连续失败仍在退避窗口内，则跳过本次抓取。
 * 留 30 秒余量，避免 5 分钟定时器刚好卡在间隔上被跳过。
 */
function shouldSkip(rows, now, intervalMin) {
  if (!rows || !rows.length) return null;
  const latest = rows[0];
  const at = latest.at;
  if (typeof at !== 'number' || !isFinite(at)) return null;

  let waitMin = intervalMin;
  let reason = 'interval';
  if (!latest.ok) {
    let fails = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ok) break;
      fails += 1;
    }
    waitMin = Math.min(intervalMin * Math.pow(2, fails), BACKOFF_CAP_MIN);
    reason = 'backoff';
  }

  if (now - at + SLACK_MS < waitMin * 60 * 1000) {
    return { skip: true, reason: reason, waitMin: waitMin };
  }
  return null;
}

module.exports = { shouldSkip };
