function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** times 为额外重试次数。times = 2 时最多请求 3 次。 */
async function withRetry(fn, times, wait) {
  const delay = wait || sleep;
  let lastErr;
  for (let i = 0; i <= times; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === times) break;
      await delay(1000);
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
