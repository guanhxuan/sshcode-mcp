import { EventEmitter } from 'events';

export class MCPServer extends EventEmitter {
  constructor(fileManager, commandExecutor, config) {
    super();
    this.fm = fileManager;
    this.cmdexec = commandExecutor;
    this.config = config;
    this.connectionConfig = null;
    this._buffer = '';
    this._pending = new Map();
    this._initialized = false;
  }

  setConnectionConfig(connectionConfig) {
    this.connectionConfig = connectionConfig;
  }

  start() {
    this._setupStdio();
  }

  _setupStdio() {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      this._buffer += chunk;
      this._processBuffer();
    });
    process.stdin.on('end', () => {
      this.emit('end');
    });
    process.on('SIGINT', () => {
      this.emit('end');
      process.exit(0);
    });
  }

  _processBuffer() {
    if (this._processing) return;
    this._processing = true;

    const pending = [];
    while (this._buffer.includes('\n')) {
      const idx = this._buffer.indexOf('\n');
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.method) {
          pending.push(this._handleRequest(msg));
        } else if (msg.id !== undefined) {
          const p = this._pending.get(msg.id);
          if (p) {
            this._pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || 'RPC error'));
            else p.resolve(msg.result);
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    this._processing = false;
    if (pending.length) Promise.all(pending).catch(() => {});
  }

  async _handleRequest(request) {
    const { id, method, params } = request;
    try {
      const start = Date.now();
      const result = await this._dispatch(method, params || {});
      this._send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      this._send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error.message || String(error) },
      });
    }
  }

  async _dispatch(method, params) {
    switch (method) {
      case 'initialize':
        return this._initialize(params);
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return {};
      case 'ping':
        return {};
      case 'tools/list':
        return this._toolsList();
      case 'tools/call':
        return this._toolsCall(params);
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  _initialize(params) {
    this._initialized = true;
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: 'sshcode-mcp',
        version: '0.1.0',
      },
    };
  }

  _toolsList() {
    return {
      tools: [
        {
          name: 'execute_command',
          description: '在远程服务器执行 shell 命令',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '要执行的 shell 命令' },
              timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）' },
              workdir: { type: 'string', description: '命令的工作目录' },
            },
            required: ['command'],
          },
        },
        {
          name: 'read_file',
          description: '读取远程文件内容',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件绝对路径' },
            },
            required: ['path'],
          },
        },
        {
          name: 'write_file',
          description: '写入/覆盖远程文件',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件绝对路径' },
              content: { type: 'string', description: '文件内容' },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'edit_file',
          description: '编辑远程文件的指定行（按行号，支持批量编辑）',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件绝对路径' },
              edits: {
                type: 'array',
                description: '编辑操作列表（从下往上应用）',
                items: {
                  type: 'object',
                  properties: {
                    start: { type: 'number', description: '起始行号（从1开始）' },
                    end: { type: 'number', description: '结束行号（含，默认等于start）' },
                    oldText: { type: 'string', description: '期望的原有文本（用于校验）' },
                    newText: { type: 'string', description: '替换的新文本' },
                  },
                  required: ['start'],
                },
              },
            },
            required: ['path', 'edits'],
          },
        },
        {
          name: 'list_directory',
          description: '列出远程目录内容',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录绝对路径' },
            },
            required: ['path'],
          },
        },
        {
          name: 'create_directory',
          description: '在远程服务器创建目录',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录绝对路径' },
              recursive: { type: 'boolean', description: '是否递归创建父目录' },
            },
            required: ['path'],
          },
        },
        {
          name: 'delete_path',
          description: '删除远程文件或目录',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '要删除的绝对路径' },
              recursive: { type: 'boolean', description: '目录时是否递归删除' },
            },
            required: ['path'],
          },
        },
        {
          name: 'rename_path',
          description: '重命名/移动远程文件或目录',
          inputSchema: {
            type: 'object',
            properties: {
              oldPath: { type: 'string', description: '当前绝对路径' },
              newPath: { type: 'string', description: '新绝对路径' },
            },
            required: ['oldPath', 'newPath'],
          },
        },
        {
          name: 'file_stat',
          description: '获取远程文件/目录元数据',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件的绝对路径' },
            },
            required: ['path'],
          },
        },
        {
          name: 'search_files',
          description: '在远程服务器搜索文件（glob 模式）',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'glob 模式（如 "**/*.js"）' },
              workdir: { type: 'string', description: '起始目录（默认 "."）' },
            },
            required: ['pattern'],
          },
        },
        {
          name: 'get_system_info',
          description: '获取远程服务器的系统信息',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'get_pool_stats',
          description: '获取连接池和缓存统计',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  }

  async _toolsCall(params) {
    if (!this.connectionConfig) {
      throw new Error('SSH not configured. Set SSHCODE_HOST and SSHCODE_USER env vars.');
    }
    const { name, arguments: args } = params;

    switch (name) {
      case 'execute_command': {
        let cmd = args.command;
        if (args.workdir) cmd = `cd "${args.workdir}" && ${cmd}`;
        const result = await this.fm.execCommand(this.connectionConfig, cmd, { timeout: args.timeout });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.code }, null, 2),
          }],
        };
      }
      case 'read_file': {
        const content = await this.fm.readFile(this.connectionConfig, args.path);
        return { content: [{ type: 'text', text: content }] };
      }
      case 'write_file': {
        await this.fm.writeFile(this.connectionConfig, args.path, args.content);
        return { content: [{ type: 'text', text: `File written: ${args.path}` }] };
      }
      case 'edit_file': {
        const result = await this.fm.editFile(this.connectionConfig, args.path, args.edits);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'list_directory': {
        const entries = await this.fm.listDir(this.connectionConfig, args.path);
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }
      case 'create_directory': {
        const result = await this.fm.mkdir(this.connectionConfig, args.path, { recursive: args.recursive });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'delete_path': {
        const result = await this.fm.delete(this.connectionConfig, args.path, { recursive: args.recursive });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'rename_path': {
        const result = await this.fm.rename(this.connectionConfig, args.oldPath, args.newPath);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'file_stat': {
        const stat = await this.fm.stat(this.connectionConfig, args.path);
        return { content: [{ type: 'text', text: JSON.stringify(stat, null, 2) }] };
      }
      case 'search_files': {
        const files = await this.fm.glob(this.connectionConfig, args.pattern, args.workdir);
        return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
      }
      case 'get_system_info': {
        const result = await this.fm.execCommand(this.connectionConfig,
          'uname -a && echo "---" && cat /etc/os-release 2>/dev/null || cat /etc/*release 2>/dev/null && echo "---" && free -h 2>/dev/null && echo "---" && df -h / 2>/dev/null && echo "---" && nproc 2>/dev/null && echo "---" && cat /proc/meminfo 2>/dev/null | head -5'
        );
        return { content: [{ type: 'text', text: result.stdout || 'N/A' }] };
      }
      case 'get_pool_stats': {
        const poolStats = this.cmdexec.pool.getStats();
        const cacheStats = this.fm.getCacheStats();
        const cmdStats = this.cmdexec.getStats();
        return { content: [{ type: 'text', text: JSON.stringify({ pool: poolStats, cache: cacheStats, commands: cmdStats }, null, 2) }] };
      }
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
    }
  }

  _send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  async stop() {
    if (this.cmdexec) this.cmdexec.cancelAll();
    if (this.fm) this.fm.clearCache();
    this.emit('stop');
  }
}
