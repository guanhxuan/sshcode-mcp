import { EventEmitter } from 'events';
import { SSHClient } from './SSHClient.js';

export class SessionPool {
  constructor(config) {
    this.config = config;
    this.pool = new Map();
    this.inUse = new Set();
    this.pending = new Map();
    this.cleanupTimer = setInterval(() => this._evictIdle(), config.pool.idleTimeout / 2);
    this._evictIdle = this._evictIdle.bind(this);
  }

  key(host, port, username) {
    return `${username}@${host}:${port}`;
  }

  async acquire(connectionConfig) {
    const { host, port = this.config.ssh.port, username } = connectionConfig;
    const k = this.key(host, port, username);

    const existing = this.pool.get(k);
    if (existing && !this.inUse.has(existing)) {
      if (existing.isAlive()) {
        this.inUse.add(existing);
        existing.lastUsed = Date.now();
        return existing;
      }
      this.pool.delete(k);
    }

    if (this.pending.has(k)) {
      const client = await this.pending.get(k);
      this.inUse.add(client);
      return client;
    }

    const connectPromise = this._createConnection(connectionConfig, k);
    this.pending.set(k, connectPromise);

    try {
      const client = await connectPromise;
      this.inUse.add(client);
      return client;
    } finally {
      this.pending.delete(k);
    }
  }

  async _createConnection(config, key) {
    if (this.pool.size >= this.config.pool.maxSize) {
      await this._evictLeastRecentlyUsed();
    }

    const client = new SSHClient(this.config);
    await client.connect(config);
    this.pool.set(key, client);
    return client;
  }

  async release(client) {
    this.inUse.delete(client);
    if (client) {
      client.lastUsed = Date.now();
    }
  }

  async remove(client) {
    this.inUse.delete(client);
    if (client && client.id) {
      this.pool.delete(client.id);
    }
    if (client) {
      await client.disconnect();
    }
  }

  async execute(connectionConfig, command, options = {}) {
    const client = await this.acquire(connectionConfig);
    try {
      return await client.exec(command, options);
    } finally {
      await this.release(client);
    }
  }

  executeStream(connectionConfig, command, options = {}) {
    const emitter = new EventEmitter();

    (async () => {
      let client;
      try {
        client = await this.acquire(connectionConfig);
        const stream = client.execStream(command, options);

        stream.on('data', (data) => emitter.emit('data', data));
        stream.on('close', (result) => {
          emitter.emit('close', result);
          this.release(client);
        });
        stream.on('error', (err) => {
          emitter.emit('error', err);
          this.release(client);
        });
      } catch (err) {
        emitter.emit('error', err);
        if (client) this.release(client);
      }
    })();

    return emitter;
  }

  async _evictIdle() {
    const now = Date.now();
    const maxIdle = this.config.pool.idleTimeout;

    for (const [key, client] of this.pool) {
      if (this.inUse.has(client)) continue;
      if (now - client.lastUsed > maxIdle) {
        this.pool.delete(key);
        await client.disconnect();
      }
    }
  }

  async _evictLeastRecentlyUsed() {
    let oldest = null;
    let oldestKey = null;

    for (const [key, client] of this.pool) {
      if (this.inUse.has(client)) continue;
      if (!oldest || client.lastUsed < oldest.lastUsed) {
        oldest = client;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey);
      await oldest.disconnect();
    }
  }

  async drain() {
    clearInterval(this.cleanupTimer);
    const clients = [...this.pool.values()];
    this.pool.clear();
    this.inUse.clear();
    await Promise.all(clients.map(c => c.disconnect().catch(() => {})));
  }

  getStats() {
    return {
      total: this.pool.size,
      inUse: this.inUse.size,
      idle: this.pool.size - this.inUse.size,
      maxSize: this.config.pool.maxSize,
    };
  }
}
