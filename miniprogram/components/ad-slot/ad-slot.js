Component({
  properties: {
    slotId: { type: String, value: '' },
    tag: { type: String, value: '广告' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    image: { type: String, value: '' },
    path: { type: String, value: '' }
  },

  data: {
    failed: false
  },

  methods: {
    onTap() {
      const path = this.data.path || '';
      if (!path) return;
      this.triggerEvent('open', { path: path, slotId: this.data.slotId });
    },

    onImageError() {
      this.setData({ failed: true });
    }
  }
});
