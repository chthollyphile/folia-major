# Folia Cloudflare D1 同步 Worker

这个模板用于让用户在自己的 Cloudflare Workers + D1 上托管 Folia 同步服务。

它保存的数据包括：

- 外观设置
- AI 主题记录

它不会同步音频文件、封面、本地音乐文件、账号登录状态、上传字体或图片。

## 部署

1. 安装 Wrangler 并登录 Cloudflare：

```bash
npm install -g wrangler
wrangler login
```

2. 复制本地部署配置：

```bash
cp wrangler.toml wrangler.local.toml
```

`wrangler.local.toml` 已被仓库 `.gitignore` 忽略，用来保存你自己的 `database_id`，不要提交到 git。

3. 创建一个 D1 数据库：

```bash
wrangler d1 create folia-sync --config wrangler.local.toml
```

始终带上 `--config wrangler.local.toml`。否则 Wrangler 可能会读取并修改仓库根目录的 `wrangler.jsonc`。

4. 把命令输出中的 `database_id` 填入 `wrangler.local.toml`，并确保 `binding` 是 `FOLIA_SYNC_DB`：

```toml
[[d1_databases]]
binding = "FOLIA_SYNC_DB"
database_name = "folia-sync"
database_id = "你的 database_id"
```

Wrangler 输出里的 `binding` 可能是 `folia_sync`，不要直接照抄这个字段。Worker 代码读取的是 `env.FOLIA_SYNC_DB`，所以这里必须使用 `FOLIA_SYNC_DB`。

5. 在**当前目录** (`folia-major/docs/sync/cloudflare-d1-worker`) 设置同步 token：

```bash
wrangler secret put SYNC_TOKEN --config wrangler.local.toml
```

6. 部署 Worker：

```bash
wrangler deploy --config wrangler.local.toml
```

7. 在 Folia 中打开 `设置 -> 存储 -> 同步服务`，然后填写：

- Sync Server URL：部署完成后输出的 Worker URL
- Bearer Token：和 `SYNC_TOKEN` 相同的值

如果你在 Folia 源码仓库中运行 Wrangler，请始终显式传入配置文件：

```bash
wrangler deploy --config wrangler.local.toml
```

仓库根目录也有一个用于部署 Folia Web 应用的 Wrangler 配置。不要在这里直接运行 `wrangler deploy`：Wrangler 可能会读取根目录配置，然后部署 `folia-major`，而不是这个同步 Worker。

## API

客户端会携带 `Authorization: Bearer <SYNC_TOKEN>` 调用这些接口：

- `GET /health`
- `GET /state`
- `GET /settings`
- `PUT /settings`
- `GET /themes/manifest`
- `POST /themes/bucket`
- `POST /themes/get`
- `POST /themes/put`
- `POST /themes/list`

Worker 会在第一次请求时自动创建所需 D1 表。

如果你之前已经部署过早期开发版 D1 Worker，建议重新创建一个 D1 数据库，或清空旧的 `themes` 表后重新同步。当前开发版主题表需要 `bucket_id` 字段，并依赖 `theme_buckets` 摘要表来做 Merkle/bucket diff。

## 数据结构

主题按歌曲 fingerprint 存储为 D1 行：

```sql
CREATE TABLE themes (
  fingerprint TEXT PRIMARY KEY,
  bucket_id INTEGER NOT NULL,
  theme_json TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_themes_updated_at ON themes(updated_at);
CREATE INDEX idx_themes_bucket_id ON themes(bucket_id);
```

Worker 会额外维护 256 个主题 bucket 摘要：

```sql
CREATE TABLE theme_buckets (
  bucket_id INTEGER PRIMARY KEY,
  count INTEGER NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT
);
```

同步时客户端先读 `/state`。如果本地水位不一致，再读 `/themes/manifest` 对比 256 个 bucket 的 `count + hash + updatedAt`，只对不一致 bucket 调用 `/themes/bucket` 拉取主题并做双向补齐。

设置按 key 存储为 D1 行：

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

写入数据（如 `PUT /settings`、`POST /themes/put`）时，Worker 会比较传入数据的 `updated_at` 和数据库中的现有值，只有当传入的时间戳更新或相等时才会执行覆盖，以防止旧数据覆盖新数据。

## 手动全库导入导出

Folia 可以导出一个 zip 备份。zip 中包含：

```text
meta.json
settings/current.json
themes/themes.json
```

导入备份时会先更新本地同步缓存。如果同步服务已启用，并且 Worker 配置完整，Folia 也会把导入的设置和主题记录推送到 Worker。

## 自托管兼容

Folia 客户端不直接依赖 D1，只依赖上面的 Sync API。

如果用户想自托管，可以用 Docker + SQLite、PostgreSQL、WebDAV 包装服务等方式实现同一套 API。只要接口行为一致，Folia 设置中填写对应的 Sync Server URL 和 Bearer Token 即可。
