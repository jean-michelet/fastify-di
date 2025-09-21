export function createServiceSample(id) {
  return {
    id,
    state: { counter: 0 },
    increment() {
      this.state.counter++;
    },
  };
}
