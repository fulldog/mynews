/**
 * 全局配置 —— 开通云开发后只改这个文件
 */
module.exports = {
  // 云开发环境 ID，如 'news-8gk1b2c3d'。留空则使用账号默认环境
  envId: '',

  // 数据模式
  // 'static' 只用包内 data/hot.js：零云成本、零请求，内容随发版更新
  // 'auto'   先调云函数 getHot（无数据库），失败静默回落包内静态数据
  dataMode: 'auto',

  // 微信云开发函数名。当前走下面的 HTTP 地址，这里留空
  cloudFn: '',

  // 请求云函数时附带的 token，须与云函数环境变量 TOKEN 完全一致
  token: '3Loe8QRgZK3oojXnIVGpDDPr6_OsuQrR',

  // 腾讯云 SCF Web函数地址。请求时会自动加上 ?token=
  apiBase: 'https://1251554333-cjbpwwffjo.ap-shanghai.tencentscf.com',

  // 距离上一次打开超过这么多分钟，才重新请求云函数；否则用本地缓存
  cacheTTLMin: 10,

  // 首页每个类目块展示条数
  pageSize: 10,

  // 云函数每类目最多保留条数（B站等类目原始 100 条，截断可减小传输体积）
  maxPerCat: 30,

  // 广告位：按全局类目序号，每 2 个类目插 1 个。
  // image 和 path 都空时不展示；图片加载失败也会把该位藏掉。
  adInterval: 2,
  adSlots: [
    { tag: '广告', title: '广告位 1', desc: '点击在 utils/config.js 中替换内容', image: '', path: '' },
    { tag: '广告', title: '广告位 2', desc: '支持图片 + 跳转小程序页', image: '', path: '' },
    { tag: '广告', title: '广告位 3', desc: '支持图片 + 跳转小程序页', image: '', path: '' },
    { tag: '广告', title: '广告位 4', desc: '支持图片 + 跳转小程序页', image: '', path: '' }
  ]
};
