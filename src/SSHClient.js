import { Client } from 'ssh2';
import { EventEmitter } from 'events';

export class SSHClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.conn = null;
    this.sftp = null;
    this.connected = false;
    this.lastUsed = 0;
    this.id = null;
    this._pendingSftp = null;
  }

  async connect(options) {
    if (this.connected) {
      await this.disconnect();
    }

    const connectConfig = {
      host: options.host,
      port: options.port || this.config.ssh.port,
      username: options.username,
      privateKey: options.privateKey || undefined,
      password: options.password || undefined,
      agent: options.agent || process.env.SSH_AUTH_SOCK,
      keepaliveInterval: this.config.ssh.keepaliveInterval,
      keepaliveCountMax: this.config.ssh.keepaliveCountMax,
      readyTimeout: this.config.ssh.readyTimeout,
      compression: options.compression ?? this.config.ssh.compression,
      algorithms: {
        cipher: [
          'aes128-gcm@openssh.com',
          'aes256-gcm@openssh.com',
          'chacha20-poly1305@openssh.com',
          'aes128-ctr',
          'aes256-ctr',
        ],
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256',
          'diffie-hellman-group14-sha256',
        ],
        mac: [
          'hmac-sha2-256-etm@openssh.com',
          'hmac-sha2-512-etm@openssh.com',
          'hmac-sha2-256',
        ],
      },
    };

    if (options.keyFile) {
      const { readFileSync } = await import('fs');
      try {
        connectConfig.privateKey = readFileSync(options.keyFile, 'utf-8');
      } catch (e) {
        throw new Error(`Failed to read key file: ${e.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('SSH connection timeout'));
      }, this.config.ssh.readyTimeout);

      conn.on('ready', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.conn = conn;
        this.lastUsed = Date.now();
        this.id = `${options.username}@${options.host}:${options.port}`;

        conn.on('close', () => {
          this.connected = false;
          this.sftp = null;
          this.emit('close');
        });

        conn.on('error', (err) => {
          this.emit('error', err);
        });

        conn.on('end', () => {
          this.connected = false;
          this.sftp = null;
          this.emit('end');
        });

        resolve(this);
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(new Error('SSH connection closed before ready'));
        }
      });

      conn.connect(connectConfig);
    });
  }

  async exec(command, options = {}) {
    if (!this.connected || !this.conn) {
      throw new Error('Not connected');
    }

    const timeout = options.timeout || this.config.command.defaultTimeout;
    const maxOutput = options.maxOutput || this.config.command.maxOutputSize;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let code = null;
      let signal = null;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (stream) stream.close();
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
      };

      let stream;
      this.conn.exec(command, {
        pty: options.pty !== false,
        env: options.env || {},
      }, (err, s) => {
        if (err) {
          cleanup();
          return reject(err);
        }
        stream = s;

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
          if (stderr.length > maxOutput) {
            stderr = stderr.slice(0, maxOutput) + '\n... (truncated)';
            stream.close();
          }
        });

        stream.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > maxOutput) {
            stdout = stdout.slice(0, maxOutput) + '\n... (truncated)';
            stream.close();
          }
        });

        stream.on('close', (exitCode, exitSignal) => {
          cleanup();
          code = exitCode;
          signal = exitSignal;
          if (timedOut) {
            reject(new Error(`Command timed out after ${timeout}ms`));
          } else {
            resolve({ stdout, stderr, code, signal });
          }
        });

        stream.on('error', (error) => {
          cleanup();
          reject(error);
        });
      });
    });
  }

  execStream(command, options = {}) {
    if (!this.connected || !this.conn) {
      throw new Error('Not connected');
    }

    const timeout = options.timeout || this.config.command.defaultTimeout;
    const maxOutput = options.maxOutput || this.config.command.maxOutputSize;
    const emitter = new EventEmitter();
    let isClosed = false;
    let stdoutSize = 0;
    let stderrSize = 0;

    const timer = setTimeout(() => {
      if (!isClosed) {
        isClosed = true;
        emitter.emit('error', new Error(`Command timed out after ${timeout}ms`));
      }
    }, timeout);

    this.conn.exec(command, {
      pty: options.pty !== false,
      env: options.env || {},
    }, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        emitter.emit('error', err);
        return;
      }

      stream.stderr.on('data', (data) => {
        stderrSize += data.length;
        if (stderrSize > maxOutput) {
          emitter.emit('data', { type: 'stderr', data: data.toString() });
          emitter.emit('data', { type: 'stderr', data: '\n... (truncated)' });
          stream.close();
        } else {
          emitter.emit('data', { type: 'stderr', data: data.toString() });
        }
      });

      stream.on('data', (data) => {
        stdoutSize += data.length;
        if (stdoutSize > maxOutput) {
          emitter.emit('data', { type: 'stdout', data: data.toString() });
          emitter.emit('data', { type: 'stdout', data: '\n... (truncated)' });
          stream.close();
        } else {
          emitter.emit('data', { type: 'stdout', data: data.toString() });
        }
      });

      stream.on('close', (code, signal) => {
        clearTimeout(timer);
        isClosed = true;
        emitter.emit('close', { code, signal });
      });

      stream.on('error', (error) => {
        clearTimeout(timer);
        isClosed = true;
        emitter.emit('error', error);
      });
    });

    return emitter;
  }

  async getSftp() {
    if (this.sftp) return this.sftp;
    if (this._pendingSftp) return this._pendingSftp;

    if (!this.connected || !this.conn) {
      throw new Error('Not connected');
    }

    this._pendingSftp = new Promise((resolve, reject) => {
      this.conn.sftp((err, sftp) => {
        if (err) {
          this._pendingSftp = null;
          return reject(err);
        }
        this.sftp = sftp;
        resolve(sftp);
      });
    });

    try {
      const sftp = await this._pendingSftp;
      this._pendingSftp = null;
      return sftp;
    } catch (e) {
      this._pendingSftp = null;
      throw e;
    }
  }

  async readFile(path, options = {}) {
    const sftp = await this.getSftp();
    const encoding = options.encoding || 'utf-8';
    const maxSize = options.maxSize || this.config.cache.maxFileSize;

    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, stat) => {
        if (err) return reject(err);
        if (stat.size > maxSize) {
          return reject(new Error(`File too large (${stat.size} > ${maxSize} bytes)`));
        }

        let result = Buffer.alloc(stat.size);
        let offset = 0;
        const readStream = sftp.createReadStream(path, {
          flags: 'r',
          encoding: null,
          autoClose: true,
        });

        readStream.on('data', (chunk) => {
          if (offset + chunk.length > result.length) {
            result = Buffer.concat([result.slice(0, offset), chunk]);
          } else {
            chunk.copy(result, offset);
          }
          offset += chunk.length;
        });

        readStream.on('end', () => {
          resolve(encoding === 'buffer' ? result : result.toString(encoding));
        });

        readStream.on('error', reject);
      });
    });
  }

  async writeFile(path, content, options = {}) {
    const sftp = await this.getSftp();
    const encoding = options.encoding || 'utf-8';
    const data = typeof content === 'string' ? Buffer.from(content, encoding) : content;

    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(path, {
        flags: 'w',
        encoding: null,
        autoClose: true,
        mode: options.mode || 0o644,
      });

      let resolved = false;
      const done = (err) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve();
      };

      writeStream.on('finish', () => done());
      writeStream.on('close', () => done());
      writeStream.on('error', done);
      writeStream.end(data);
    });
  }

  async listDir(path) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) return reject(err);
        resolve(list.map((item) => ({
          filename: item.filename,
          longname: item.longname,
          attrs: {
            size: item.attrs.size,
            mode: item.attrs.mode,
            uid: item.attrs.uid,
            gid: item.attrs.gid,
            atime: item.attrs.atime * 1000,
            mtime: item.attrs.mtime * 1000,
            isDirectory: item.attrs.isDirectory(),
            isFile: item.attrs.isFile(),
            isSymbolicLink: item.attrs.isSymbolicLink(),
          },
        })));
      });
    });
  }

  async stat(path) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, stat) => {
        if (err) return reject(err);
        resolve({
          size: stat.size,
          mode: stat.mode,
          uid: stat.uid,
          gid: stat.gid,
          atime: stat.atime * 1000,
          mtime: stat.mtime * 1000,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        });
      });
    });
  }

  async mkdir(path, mode = 0o755) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.mkdir(path, { mode }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async deleteFile(path) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.unlink(path, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async rmdir(path, recursive = false) {
    const sftp = await this.getSftp();
    if (!recursive) {
      return new Promise((resolve, reject) => {
        sftp.rmdir(path, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    const entries = await this.listDir(path);
    for (const entry of entries) {
      const fullPath = `${path}/${entry.filename}`;
      if (entry.attrs.isDirectory) {
        await this.rmdir(fullPath, true);
      } else {
        await this.deleteFile(fullPath);
      }
    }
    return this.rmdir(path, false);
  }

  async rename(oldPath, newPath) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async disconnect() {
    if (this.sftp) {
      try { this.sftp.end(); } catch {}
      this.sftp = null;
    }
    if (this.conn) {
      this.connected = false;
      try { this.conn.end(); } catch {}
      this.conn = null;
    }
    this.id = null;
  }

  isAlive() {
    return this.connected && this.conn !== null;
  }
}
