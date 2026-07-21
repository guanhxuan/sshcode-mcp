import { FileCache } from './FileCache.js';

export class FileManager {
  constructor(config, sessionPool) {
    this.config = config;
    this.pool = sessionPool;
    this.cache = new FileCache(config);
  }

  async readFile(connectionConfig, path, options = {}) {
    const { host, port = this.config.ssh.port, username } = connectionConfig;

    const cached = this.cache.get(host, port, username, path);
    if (cached && !options.forceRefresh) {
      return cached;
    }

    const client = await this.pool.acquire(connectionConfig);
    try {
      const content = await client.readFile(path, options);
      if (typeof content === 'string') {
        this.cache.set(host, port, username, path, content);
      }
      return content;
    } finally {
      await this.pool.release(client);
    }
  }

  async writeFile(connectionConfig, path, content, options = {}) {
    const { host, port = this.config.ssh.port, username } = connectionConfig;

    const client = await this.pool.acquire(connectionConfig);
    try {
      await client.writeFile(path, content, options);
      this.cache.invalidate(host, port, username, path);
    } finally {
      await this.pool.release(client);
    }
  }

  async editFile(connectionConfig, path, edits, options = {}) {
    const { host, port = this.config.ssh.port, username } = connectionConfig;

    const content = await this.readFile(connectionConfig, path, options);
    const lines = content.split('\n');
    const reversed = [...edits]
      .sort((a, b) => (b.start ?? b.line) - (a.start ?? a.line));

    for (const edit of reversed) {
      const start = (edit.start ?? edit.line) - 1;
      const end = edit.end ? edit.end - 1 : start;

      if (edit.oldText !== undefined) {
        const origBlock = lines.slice(start, end + 1).join('\n');
        if (origBlock !== edit.oldText) {
          throw new Error(
            `Edit mismatch at line ${start + 1}: expected "${edit.oldText.substring(0, 50)}...", ` +
            `found "${origBlock.substring(0, 50)}..."`
          );
        }
      }

      if (edit.newText !== undefined) {
        const newLines = edit.newText.split('\n');
        lines.splice(start, end - start + 1, ...newLines);
      } else if (edit.content !== undefined) {
        lines[start] = edit.content;
      }
    }

    const newContent = lines.join('\n');
    await this.writeFile(connectionConfig, path, newContent);

    return {
      path,
      size: Buffer.byteLength(newContent, 'utf-8'),
      lines: lines.length,
    };
  }

  async listDir(connectionConfig, path) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      const entries = await client.listDir(path);
      return entries.map(e => ({
        name: e.filename,
        type: e.attrs.isDirectory ? 'directory' :
              e.attrs.isSymbolicLink ? 'symlink' : 'file',
        size: e.attrs.size,
        mode: e.attrs.mode.toString(8).slice(-4),
        modified: new Date(e.attrs.mtime).toISOString(),
      }));
    } finally {
      await this.pool.release(client);
    }
  }

  async stat(connectionConfig, path) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      return await client.stat(path);
    } finally {
      await this.pool.release(client);
    }
  }

  async mkdir(connectionConfig, path, options = {}) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      await client.mkdir(path, options.mode);
      return { path, created: true };
    } catch (e) {
      if (e.code === 4 && options.recursive) {
        await this.execCommand(connectionConfig, `mkdir -p "${path}"`);
        return { path, created: true };
      }
      throw e;
    } finally {
      await this.pool.release(client);
    }
  }

  async delete(connectionConfig, path, options = {}) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      const stat = await client.stat(path);
      if (stat.isDirectory) {
        await client.rmdir(path, options.recursive);
      } else {
        await client.deleteFile(path);
      }
      const { host, port = this.config.ssh.port, username } = connectionConfig;
      this.cache.invalidateAll(host, port, username);
      return { path, deleted: true };
    } finally {
      await this.pool.release(client);
    }
  }

  async rename(connectionConfig, oldPath, newPath) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      await client.rename(oldPath, newPath);
      const { host, port = this.config.ssh.port, username } = connectionConfig;
      this.cache.invalidateAll(host, port, username);
      return { oldPath, newPath, renamed: true };
    } finally {
      await this.pool.release(client);
    }
  }

  async exists(connectionConfig, path) {
    const client = await this.pool.acquire(connectionConfig);
    try {
      return await client.exists(path);
    } finally {
      await this.pool.release(client);
    }
  }

  async glob(connectionConfig, pattern, workingDir = '.') {
    const sanitized = pattern.replace(/['"]/g, '');
    const cmd = [
      `cd "${workingDir}"`,
      `find . -maxdepth 3 -name '${sanitized}' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
      `find . -maxdepth 1 -name '${sanitized}' 2>/dev/null`,
      `ls -d '${sanitized}' 2>/dev/null`,
    ].join(' && ');
    const result = await this.execCommand(connectionConfig, cmd);
    return [...new Set(
      result.stdout.trim().split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.startsWith('./') ? l.slice(2) : l)
    )];
  }

  async execCommand(connectionConfig, command, options = {}) {
    return this.pool.execute(connectionConfig, command, options);
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache() {
    this.cache.destroy();
    this.cache = new FileCache(this.config);
  }
}
