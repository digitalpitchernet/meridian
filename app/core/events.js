// Minimal synchronous event bus. Modules talk to each other only through repositories and these events.
export function createBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, detail) {
      for (const fn of handlers.get(type) || []) { try { fn(detail); } catch (e) { console.error(`[bus] ${type} handler failed`, e); } }
      for (const fn of handlers.get('*') || []) { try { fn({ type, detail }); } catch (e) { console.error('[bus] * handler failed', e); } }
    },
  };
}
export const bus = createBus();
