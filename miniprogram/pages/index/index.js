const { buildBlocks } = require('../../utils/blocks');
const { openOriginal } = require('../../utils/open');
const {
  loadGroups,
  describeSource,
  shouldReload,
  markRead,
  readMap,
  applyRead
} = require('../../utils/data-source');

const EMPTY_HINT = '暂无数据。先在本机执行 node scripts/build-data.js 生成内置数据文件，再重新编译。';

Page({
  data: {
    blocks: [],
    anchors: [],
    loading: true,
    error: '',
    dataHint: '',
    scrollTo: '',
    activeGid: '',
    skCards: [
      { id: 1, rows: [1, 2, 3, 4] },
      { id: 2, rows: [1, 2, 3] },
      { id: 3, rows: [1, 2, 3, 4] }
    ]
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    // onLoad 已经拉过一次。之后回到本页：要刷新就重新请求，否则只刷新已读置灰。
    if (!this._shown) {
      this._shown = true;
      return;
    }
    if (shouldReload()) this.loadData();
    else this.paintRead();
  },

  onPullDownRefresh() {
    this.loadData(true);
  },

  async loadData(fromPull) {
    const ticket = (this._ticket || 0) + 1;
    this._ticket = ticket;
    if (fromPull) this._pulling = true;

    const endPull = () => {
      if (ticket === this._ticket && this._pulling) {
        this._pulling = false;
        wx.stopPullDownRefresh();
      }
    };

    if (!wx.cloud && this.data.blocks.length === 0) {
      // 游客模式/未开通云开发：走包内静态数据，不报错
      console.info('[数据] 云开发不可用，使用包内 data/hot.js');
    }

    this.setData({ loading: this.data.blocks.length === 0, error: '' });

    try {
      const res = await loadGroups({ force: !!fromPull });
      if (ticket !== this._ticket) return;

      const groups = (res.groups || []).filter((g) => g && g.categories && g.categories.length);
      if (!groups.length) {
        this.setData({ loading: false, error: EMPTY_HINT, blocks: [], anchors: [] });
        return;
      }

      this._groups = groups;
      const view = buildBlocks(groups);
      this._lastLoad = Date.now();
      const activeGid = this.data.activeGid || (view.anchors[0] && view.anchors[0].gid) || '';
      this.setData({
        blocks: applyRead(view.blocks, readMap()),
        anchors: view.anchors,
        loading: false,
        error: '',
        dataHint: describeSource(res.from, res.at),
        activeGid: activeGid
      });
    } catch (err) {
      if (ticket !== this._ticket) return;
      console.error('[首页加载失败]', err);
      if (this.data.blocks.length) {
        this.setData({ loading: false });
        wx.showToast({ title: '刷新失败', icon: 'none' });
      } else {
        const message = (err && (err.errMsg || err.message)) || '加载失败，下拉重试';
        this.setData({ loading: false, error: message });
      }
    } finally {
      endPull();
    }
  },

  onAnchor(e) {
    const gid = String(e.currentTarget.dataset.gid);
    this.setData({ scrollTo: '', activeGid: gid }, () => {
      this.setData({ scrollTo: 'g-' + gid });
    });
  },

  onMore(e) {
    const gid = e.detail.gid;
    const catKey = e.detail.catKey;
    wx.navigateTo({
      url: '/pages/list/list?gid=' + encodeURIComponent(gid) + '&key=' + encodeURIComponent(catKey)
    });
  },

  paintRead() {
    if (!this._groups) return;
    const view = buildBlocks(this._groups);
    this.setData({ blocks: applyRead(view.blocks, readMap()) });
  },

  onOpen(e) {
    const item = e.detail.item;
    const catKey = e.detail.catKey;
    markRead(catKey, item && item.id);
    this.paintRead();
    openOriginal(item, catKey);
  },

  onOpenAd(e) {
    const path = e.detail.path;
    if (path) wx.navigateTo({ url: path });
  }
});
