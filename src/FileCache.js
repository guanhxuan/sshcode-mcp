export class FileCache {
  constructor(config) {
    this.maxSize = config.cache.maxSize;
    this.maxAge = config.cache.maxAge;
    this.maxFileSize = config.cache.maxFileSize;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
    this._cleanupTimer = setInterval(() => this._evictExpired(), this.maxAge / 2);
  }

  key(host, port, username, path) {
    return `${username}@${host}:${port}:${path}`;
  }

  get(host, port, username, path) {
    const k = this.key(host, port, username, path);
    const entry = this.cache.get(k);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(k);
      this.stats.evicitions++;
      this.stats.misses++;
      return null;
    }

    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.content;
  }

  set(host, port, username, path, content) {
    if (content.length > this.maxFileSize) return;

    const k = this.key(host, port, username, path);

    if (this.cache.has(k)) {
      this.cache.delete(k);
    }

    while (this.cache.size >= this.maxSize) {
      this._evictOne();
    }

    this.cache.set(k, {
      content,
      timestamp: Date.now(),
      lastAccess: Date.now(),
      path,
    });
  }

  invalidate(host, port, username, path) {
    const k = this.key(host, port, username, path);
    this.cache.delete(k);
  }

  invalidateAll(host, port, username) {
    const prefix = `${username}@${host}:${port}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  _evictOne() {
    let oldest = null;
    let oldestKey = null;

    for (const [key, entry] of this.cache) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) {
        oldest = entry;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evicitions++;
    }
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.maxAge) {
        this.cache.delete(key);
        this.stats.evicitions++;
      }
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this.cache.clear();
  }

  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}
