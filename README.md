# sshcode-mcp

SSH Remote AI Development Tool — 通过 SSH 让 AI 在远程计算机上进行开发操作。

基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 标准协议，可作为 opencode、Claude Desktop 等 MCP 客户端的工具服务。

## 功能

| 工具 | 说明 |
|------|------|
| `execute_command` | 在远程服务器执行 shell 命令 |
| `read_file` | 读取远程文件内容 |
| `write_file` | 写入/覆盖远程文件 |
| `edit_file` | 编辑远程文件指定行（按行号） |
| `list_directory` | 列出远程目录内容 |
| `create_directory` | 创建远程目录 |
| `delete_path` | 删除远程文件/目录 |
| `rename_path` | 重命名/移动远程文件/目录 |
| `file_stat` | 获取远程文件元数据 |
| `search_files` | 在远程服务器搜索文件（glob 模式） |
| `get_system_info` | 获取远程系统信息 |
| `get_pool_stats` | 获取连接池/缓存统计 |

## 快速开始

```bash
# 安装依赖
npm install

# 密码认证
node bin/sshcode.js ubuntu@192.168.1.5 -P 123

# 密钥认证
node bin/sshcode.js ubuntu@192.168.1.5 -i ~/.ssh/id_rsa

# 自定义端口
node bin/sshcode.js ubuntu@192.168.1.5 -p 2222 -P 123
```

### 环境变量模式（MCP 推荐）

```bash
export SSHCODE_HOST=192.168.1.5
export SSHCODE_USER=ubuntu
export SSHCODE_PASSWORD=123
node bin/sshcode.js
```

## 配置为 opencode MCP 服务

在 `~/.config/opencode/opencode.jsonc` 或项目 `.opencode.jsonc` 中添加：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sshcode": {
      "type": "local",
      "command": ["node", "/path/to/sshcode_mcp/bin/sshcode.js"],
      "environment": {
        "SSHCODE_HOST": "192.168.1.5",
        "SSHCODE_USER": "ubuntu",
        "SSHCODE_PASSWORD": "123",
        "SSHCODE_PORT": "22"
      },
      "timeout": 15000
    }
  }
}
```

## 架构

```
AI (MCP Client) <-> stdio JSON-RPC <-> sshcode-mcp <-> SSH <-> Remote Server
```

## 性能优化

- **连接池**: 复用 SSH 连接（最多 5 个），避免重复握手
- **文件缓存**: LRU 缓存（最多 50 个文件，TTL 60s）
- **命令超时**: 默认 30s，防止长时间卡住
- **并发控制**: 最多 10 个并发命令
- **输出截断**: 超过 10MB 自动截断
- **SFTP 复用**: 在同一连接内复用 SFTP 通道
- **ssh 压缩**: 强制开启压缩减少带宽

## 配置

```bash
# 查看配置
node bin/sshcode.js config

# 修改配置
node bin/sshcode.js config set pool.maxSize 10
node bin/sshcode.js config set command.defaultTimeout 60000
```

## 许可证

MIT
