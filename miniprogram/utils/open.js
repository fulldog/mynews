const MP_MAP = require('./mp-map');
const { absLink } = require('./link');

/**
 * 打开原文，三级降级：
 *  ① 该类目配了 appId → 跳目标小程序
 *  ② 未配置或跳转失败（含用户取消）→ 复制链接并提示用浏览器打开
 *  ③ 没有可用链接 → Toast
 */
function openWith(item, catKey, map) {
  const link = absLink(item && item.link);
  if (!link) {
    wx.showToast({ title: '暂无原文链接', icon: 'none' });
    return Promise.resolve({ way: 'fail' });
  }

  const target = map && map[catKey];
  if (target && target.appId) {
    return new Promise((resolve) => {
      wx.navigateToMiniProgram({
        appId: target.appId,
        path: target.path || '',
        envVersion: 'release',
        success: () => resolve({ way: 'mp' }),
        fail: (err) => {
          console.warn('[跳转小程序失败]', err && err.errMsg);
          copyAndHint(link).then(resolve);
        }
      });
    });
  }

  return copyAndHint(link);
}

function copyAndHint(link) {
  return new Promise((resolve) => {
    wx.setClipboardData({
      data: link,
      success: () => {
        if (wx.hideToast) wx.hideToast();
        wx.showModal({
          title: '链接已复制',
          content: '原文需在浏览器中打开。链接已复制到剪贴板，粘贴到浏览器即可访问。',
          confirmText: '知道了',
          showCancel: false,
          complete: () => resolve({ way: 'clipboard' })
        });
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' });
        resolve({ way: 'fail' });
      }
    });
  });
}

function openOriginal(item, catKey) {
  return openWith(item, catKey, MP_MAP);
}

module.exports = { openOriginal, openWith };
