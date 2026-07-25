export function createFakeObserverFactory() {
  const instances = [];
  const factory = (callback) => {
    const instance = {
      callback,
      observations: [],
      disconnectCount: 0,
      observe(target, options) { this.observations.push({ target, options }); },
      disconnect() { this.disconnectCount += 1; },
      trigger(records = [{}]) { callback(records); },
    };
    instances.push(instance);
    return instance;
  };
  return { factory, instances };
}
