import { EventEmitter } from 'events';

export class CommandExecutor {
  constructor(config, sessionPool) {
    this.config = config;
    this.pool = sessionPool;
    this.activeCommands = new Map();
    this.maxConcurrent = config.command.maxConcurrent;
    this._commandCounter = 0;
  }

  async execute(connectionConfig, command, options = {}) {
    await this._checkConcurrency();

    const cmdId = ++this._commandCounter;
    const abortController = new AbortController();
    const entry = { id: cmdId, startTime: Date.now(), abortController };
    this.activeCommands.set(cmdId, entry);

    try {
      return await this.pool.execute(connectionConfig, command, {
        ...options,
        signal: abortController.signal,
      });
    } finally {
      this.activeCommands.delete(cmdId);
    }
  }

  executeStream(connectionConfig, command, options = {}) {
    const emitter = new EventEmitter();

    this._checkConcurrency().then(() => {
      const cmdId = ++this._commandCounter;
      const abortController = new AbortController();
      const entry = { id: cmdId, startTime: Date.now(), abortController };
      this.activeCommands.set(cmdId, entry);

      const stream = this.pool.executeStream(connectionConfig, command, options);

      stream.on('data', (data) => emitter.emit('data', data));
      stream.on('close', (result) => {
        this.activeCommands.delete(cmdId);
        emitter.emit('close', result);
      });
      stream.on('error', (err) => {
        this.activeCommands.delete(cmdId);
        emitter.emit('error', err);
      });
    }).catch((err) => {
      emitter.emit('error', err);
    });

    return emitter;
  }

  async _checkConcurrency() {
    if (this.activeCommands.size >= this.maxConcurrent) {
      throw new Error(
        `Too many concurrent commands (${this.activeCommands.size}/${this.maxConcurrent}). ` +
        'Wait for running commands to finish or increase maxConcurrent.'
      );
    }
  }

  async cancel(cmdId) {
    const entry = this.activeCommands.get(cmdId);
    if (entry) {
      entry.abortController.abort();
      this.activeCommands.delete(cmdId);
      return true;
    }
    return false;
  }

  cancelAll() {
    for (const [id, entry] of this.activeCommands) {
      entry.abortController.abort();
    }
    this.activeCommands.clear();
  }

  getStats() {
    return {
      active: this.activeCommands.size,
      maxConcurrent: this.maxConcurrent,
    };
  }
}
