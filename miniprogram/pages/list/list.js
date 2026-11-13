const config = require('../../utils/config');
const { openOriginal } = require('../../utils/open');
const {
  loadCategory,
  shouldReload,
  markRead,
  readMap,
  applyReadItems
} = require('../../utils/data-source');

Page({
  data: {
    items: [],
    name: '',
    catKey: '',
    loading: true,
    error: '',
    capped: false
  },

  onLoad(options) {
    const gid = options.gid;
    const key = options.key;
    this._gid = gid;
    this._key = key;
    this.setData({ catKey: key || '' });
    if (!gid || !key) {
      this.setData({ loading: false, error: '参数缺失' });
      return;
    }
    this.load(gid, key);
  },

  onShow() {
    if (!this._shown) {
      this._shown = true;
      return;
    }
    if (!this._gid || !this._key) return;
    if (shouldReload()) this.load(this._gid, this._key);
    else this.paintRead();
  },

  async load(gid, key) {
    try {
      const res = await loadCategory(gid, key);
      const cat = res.cat;
      if (!cat) throw new Error('该类目暂无数据');

      this._items = cat.items || [];
      wx.setNavigationBarTitle({ title: cat.name || '全部' });
      this.setData({
        name: cat.name || '',
        items: applyReadItems(this._items, key, readMap()),
        capped: this._items.length >= config.maxPerCat,
        loading: false,
        error: ''
      });
    } catch (err) {
      console.error('[列表加载失败]', err);
      this.setData({
        loading: false,
        error: (err && (err.errMsg || err.message)) || '加载失败'
      });
    }
  },

  paintRead() {
    if (!this._items) return;
    this.setData({
      items: applyReadItems(this._items, this._key || this.data.catKey, readMap())
    });
  },

  onOpen(e) {
    const item = e.detail.item;
    markRead(this.data.catKey, item && item.id);
    this.paintRead();
    openOriginal(item, this.data.catKey);
  }
});
