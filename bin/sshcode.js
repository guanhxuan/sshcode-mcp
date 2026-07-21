#!/usr/bin/env node

import { createServer } from '../src/index.js';
import { loadConfig, saveConfig } from '../src/config.js';

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args[0] === '--help' || args[0] === '-h' || (args.length === 0 && !hasEnvConfig())) {
    showHelp();
    return;
  }

  if (args[0] === 'config') {
    handleConfig(args.slice(1));
    return;
  }

  const connectionConfig = getConnectionConfig(args, config);

  if (!connectionConfig.host || !connectionConfig.username) {
    console.error('sshcode-mcp: missing host or username. Set SSHCODE_HOST and SSHCODE_USER, or pass as argument.');
    console.error('Usage: sshcode-mcp <user>@<host> [options]');
    process.exit(1);
  }

  try {
    console.error(`sshcode-mcp: connecting to ${connectionConfig.username}@${connectionConfig.host}:${connectionConfig.port}...`);
    const server = await createServer(connectionConfig);
    server.mcp.start();
    console.error('sshcode-mcp: connected. MCP server running on stdio.');

    process.on('SIGINT', async () => {
      console.error('\nsshcode-mcp: shutting down...');
      await server.shutdown();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await server.shutdown();
      process.exit(0);
    });
  } catch (err) {
    console.error(`sshcode-mcp: connection failed: ${err.message}`);
    process.exit(1);
  }
}

function getConnectionConfig(args, config) {
  const parsed = parseArgs(args);

  return {
    host: parsed.host || process.env.SSHCODE_HOST,
    port: parsed.port || parseInt(process.env.SSHCODE_PORT, 10) || config.ssh.port,
    username: parsed.username || process.env.SSHCODE_USER,
    password: parsed.password || process.env.SSHCODE_PASSWORD,
    keyFile: parsed.keyFile || process.env.SSHCODE_KEY_FILE || parsed.identityFile,
    privateKey: parsed.privateKey || process.env.SSHCODE_KEY,
    agent: parsed.agent || process.env.SSHCODE_AGENT || process.env.SSH_AUTH_SOCK,
  };
}

function hasEnvConfig() {
  return !!(process.env.SSHCODE_HOST && process.env.SSHCODE_USER);
}

function showHelp() {
  console.log(`
sshcode-mcp - SSH Remote AI Development Tool

MCP 模式（通过环境变量配置 SSH）：
  export SSHCODE_HOST=192.168.1.5
  export SSHCODE_USER=ubuntu
  export SSHCODE_PASSWORD=123
  # export SSHCODE_PORT=2222
  # export SSHCODE_KEY_FILE=~/.ssh/id_rsa
  node bin/sshcode.js

命令行模式：
  node bin/sshcode.js <用户名>@<主机> [选项]

示例：
  node bin/sshcode.js ubuntu@192.168.1.5 -P 123
  node bin/sshcode.js ubuntu@192.168.1.5 -i ~/.ssh/id_rsa
  node bin/sshcode.js ubuntu@192.168.1.5 -p 2222 -P 123

选项：
  -p, --port <端口>          SSH 端口（默认 22）
  -i, --identity-file <文件> SSH 私钥文件
  -P, --password <密码>      SSH 密码
  -k, --key <密钥>           私钥字符串
  -A, --agent <socket>       SSH agent socket

配置管理：
  node bin/sshcode.js config            查看当前配置
  node bin/sshcode.js config set <键> <值>  设置配置项

  常用配置：
    ssh.port              默认 SSH 端口（默认 22）
    pool.maxSize          最大连接数（默认 5）
    cache.maxSize         最大缓存文件数（默认 50）
    command.defaultTimeout 命令超时毫秒（默认 30000）

环境变量：
  SSHCODE_HOST      SSH 主机地址
  SSHCODE_USER      SSH 用户名
  SSHCODE_PASSWORD  SSH 密码
  SSHCODE_PORT      SSH 端口（默认 22）
  SSHCODE_KEY_FILE  SSH 私钥文件路径
  SSHCODE_KEY       SSH 私钥字符串
  SSHCODE_AGENT     SSH agent socket 路径
`);
}

function handleConfig(subargs) {
  if (subargs.length === 0) {
    console.log(JSON.stringify(loadConfig(), null, 2));
    return;
  }
  if (subargs[0] === 'set' && subargs.length >= 3) {
    const key = subargs[1];
    const value = parseValue(subargs[2]);
    saveConfig(buildNested(key, value));
    console.error(`Config updated: ${key} = ${JSON.stringify(value)}`);
  } else {
    console.error('Usage: sshcode-mcp config set <key> <value>');
  }
}

function buildNested(key, value) {
  const keys = key.split('.');
  const result = {};
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

function parseArgs(args) {
  const result = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.includes('@') && !arg.startsWith('-')) {
      const [username, host] = arg.split('@');
      result.username = username;
      result.host = host;
      i++; continue;
    }
    switch (arg) {
      case '-p': case '--port': result.port = parseInt(args[++i], 10); break;
      case '-i': case '--identity-file': result.keyFile = args[++i]; break;
      case '-P': case '--password': result.password = args[++i]; break;
      case '-k': case '--key': result.privateKey = args[++i]; break;
      case '-A': case '--agent': result.agent = args[++i]; break;
      default: if (!result.host && !arg.startsWith('-')) result.host = arg;
    }
    i++;
  }
  return result;
}

main().catch((err) => {
  console.error(`sshcode-mcp: fatal: ${err.message}`);
  process.exit(1);
});
