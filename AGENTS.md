# sshcode-mcp

SSH Remote AI Development Tool - 通过 SSH 让 AI 在远程计算机上进行开发操作。

## 快速启动

```bash
# 密码认证
node bin/sshcode.js ubuntu@192.168.1.5 -P 123

# 密钥认证
node bin/sshcode.js ubuntu@192.168.1.5 -i ~/.ssh/id_rsa

# 自定义端口
node bin/sshcode.js ubuntu@192.168.1.5 -p 2222 -P 123
```

## MCP 工具列表

| 工具名 | 说明 |
|--------|------|
| `execute_command` | 在远程服务器执行 shell 命令 |
| `read_file` | 读取远程文件内容 |
| `write_file` | 写入/覆盖远程文件 |
| `edit_file` | 编辑远程文件指定行(按行号) |
| `list_directory` | 列出远程目录内容 |
| `create_directory` | 创建远程目录 |
| `delete_path` | 删除远程文件/目录 |
| `rename_path` | 重命名/移动远程文件/目录 |
| `file_stat` | 获取远程文件元数据 |
| `search_files` | 在远程服务器搜索文件(glob 模式) |
| `get_system_info` | 获取远程系统信息 |
| `get_pool_stats` | 获取连接池/缓存统计 |

## 性能优化

- **连接池**: 复用 SSH 连接 (最多 5 个)，避免重复握手
- **文件缓存**: LRU 缓存 (最多 50 个文件，TTL 60s)
- **命令超时**: 默认 30s，防止长时间卡住
- **并发控制**: 最多 10 个并发命令
- **输出截断**: 超过 10MB 自动截断
- **SFTP 复用**: 在同一连接内复用 SFTP 通道
- **ssh 压缩**: 强制开启压缩减少带宽

## 配置

```bash
node bin/sshcode.js config
node bin/sshcode.js config set pool.maxSize 10
node bin/sshcode.js config set command.defaultTimeout 60000
```

## 架构

```
AI (MCP Client) <-> stdio JSON-RPC <-> sshcode-mcp <-> SSH <-> Remote Server
```
