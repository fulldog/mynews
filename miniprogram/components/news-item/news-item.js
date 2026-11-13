Component({
  properties: {
    item: { type: Object, value: {} },
    rank: { type: Number, value: 0 },
    hairline: { type: Boolean, value: true }
  },

  methods: {
    onTap() {
      this.triggerEvent('open', { item: this.data.item });
    }
  }
});
