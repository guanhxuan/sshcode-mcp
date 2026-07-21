#!/usr/bin/env node

import { loadConfig } from './config.js';
import { SessionPool } from './SessionPool.js';
import { CommandExecutor } from './CommandExecutor.js';
import { FileManager } from './FileManager.js';
import { MCPServer } from './MCPServer.js';

export async function createServer(connectionConfig, customConfig = {}) {
  const config = loadConfig();

  const pool = new SessionPool(config);
  const cmdexec = new CommandExecutor(config, pool);
  const fm = new FileManager(config, pool);
  const mcp = new MCPServer(fm, cmdexec, config);

  if (connectionConfig) {
    mcp.setConnectionConfig(connectionConfig);
  }

  return {
    mcp,
    pool,
    cmdexec,
    fm,
    config,
    async shutdown() {
      await mcp.stop();
      await pool.drain();
    },
  };
}

export { SessionPool } from './SessionPool.js';
export { SSHClient } from './SSHClient.js';
export { FileManager } from './FileManager.js';
export { CommandExecutor } from './CommandExecutor.js';
export { MCPServer } from './MCPServer.js';
export { loadConfig } from './config.js';
