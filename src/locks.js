export class InMemoryLock {
  constructor() {
    this.locks = new Map();
  }

  async withLock(key, ttlMs, fn) {
    const now = Date.now();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) {
      throw new Error("LOCKED");
    }

    this.locks.set(key, { expiresAt: now + ttlMs });
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
    }
  }
}

export class IdempotencyStore {
  constructor() {
    this.items = new Map();
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.items.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs) {
    this.items.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
