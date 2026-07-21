import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const CONFIG_DIR = join(homedir(), '.config', 'sshcode-mcp');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  ssh: {
    port: 22,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 10000,
    compression: 'force',
    hostVerifier: 'accept',
  },
  pool: {
    maxSize: 5,
    idleTimeout: 300000,
    acquireTimeout: 10000,
  },
  cache: {
    maxSize: 50,
    maxAge: 60000,
    maxFileSize: 1048576,
  },
  command: {
    defaultTimeout: 30000,
    maxOutputSize: 10485760,
    maxConcurrent: 10,
  },
  server: {
    transport: 'stdio',
    port: 3100,
    host: '127.0.0.1',
  },
};

let config = null;

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  if (config) return config;
  ensureConfigDir();
  let userConfig = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      userConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      console.error('Config parse error, using defaults');
    }
  }
  config = mergeDeep(structuredClone(DEFAULTS), userConfig);
  return config;
}

function mergeDeep(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      mergeDeep(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function saveConfig(updates) {
  ensureConfigDir();
  const current = loadConfig();
  config = mergeDeep(current, updates);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

function getConfig(path) {
  const cfg = loadConfig();
  const keys = path.split('.');
  let result = cfg;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return undefined;
    }
  }
  return result;
}

export { loadConfig, saveConfig, getConfig, CONFIG_DIR, DEFAULTS };
