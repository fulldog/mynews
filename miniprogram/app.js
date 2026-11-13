const config = require('./utils/config');
const { noteAppOpen } = require('./utils/data-source');

App({
  globalData: {
    cloudReady: false,
    envId: config.envId
  },

  onLaunch() {
    if (!wx.cloud) {
      console.warn('[云开发] 当前基础库不支持，将使用包内静态数据 data/hot.js');
      return;
    }
    const options = { traceUser: true };
    if (config.envId) options.env = config.envId;
    try {
      wx.cloud.init(options);
      this.globalData.cloudReady = true;
    } catch (err) {
      // 游客模式 / 未开通云开发：不阻断启动，取数层会回落到包内数据
      console.warn('[云开发] 初始化失败，改用包内静态数据', err);
    }
  },

  onShow() {
    // 从后台回到前台也算一次打开，用上一次打开的时间决定要不要重新请求
    noteAppOpen();
  }
});
