Component({
  properties: {
    gid: { type: String, value: '' },
    catKey: { type: String, value: '' },
    name: { type: String, value: '' },
    iconColor: { type: String, value: '#999999' },
    total: { type: Number, value: 0 },
    items: { type: Array, value: [] }
  },

  methods: {
    onMore() {
      this.triggerEvent('more', { gid: this.data.gid, catKey: this.data.catKey });
    },

    onOpen(e) {
      this.triggerEvent('open', {
        item: e.detail.item,
        catKey: this.data.catKey
      });
    }
  }
});
