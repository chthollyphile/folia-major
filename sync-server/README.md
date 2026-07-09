# Folia Sync Server

这是 Folia 的官方同步服务端实现。本服务以“多端同构”为目标设计，底层逻辑完全一致。

目前支持两种部署方案，你可以根据自己的需求任选其一：
- **自托管部署 (Node.js)**: 使用 SQLite，适合有自己服务器或 VPS 的用户。
- **Cloudflare D1 部署 (Serverless)**: 免费、免运维、高可用，依托 Cloudflare 全球边缘网络。

## 🔐 Token 指南

无论你采用哪种部署方案，本服务都依赖以下两种 Token 进行安全验证。在开始前，请先了解它们的用途：

> [!IMPORTANT]  
> 强烈建议在部署完成后，将你生成的 Token **妥善保存在密码管理器中**。特别是对于 Cloudflare 部署，部署后的 Token 是加密状态，无法回读。

| Token | 用途 | 是否必填 | 推荐长度 | 忘记了怎么办 |
| --- | --- | --- | --- | --- |
| `SYNC_TOKEN` | 用于客户端鉴权。Folia 客户端必须拥有此 Token 才能读取和覆盖同步数据。 | **必填** | 8 ~ 32 位随机字符 | 重新生成并覆盖环境变量 |
| `DASHBOARD_TOKEN` | 用于在浏览器中查看服务状态和数据库统计（防扫描的隐藏看板）。 | 选填 | 16 位以上的随机字符 | 重新生成并覆盖环境变量 |

### 如何生成高强度 Token？

你可以使用以下任意一种快速生成的方式：

**方法 1：浏览器控制台 (最简单)**
按 `F12` 打开浏览器控制台 (Console)，输入并运行：
```javascript
crypto.randomUUID()
```

**方法 2：Node.js 终端**
在终端中运行：
```bash
node -e "console.log(crypto.randomBytes(16).toString('hex'))"
```

**方法 3：OpenSSL (Linux/macOS 终端)**
在终端中运行：
```bash
openssl rand -hex 16
```

> [!WARNING]  
> 为防止被扫描器字典爆破，服务端**强制要求 `SYNC_TOKEN` 的长度必须大于等于 8 位**，否则服务将拒绝启动（或持续报错）。
> 对于暴露在公网的服务，强烈建议在边缘层（如 Cloudflare WAF 或 Nginx）配置 **Rate Limiting (频率限制)** 防范高频猜测攻击。

---

## 方案一：Node.js 自托管部署

使用 Node.js 运行，底层使用 `better-sqlite3`。

### 前置要求
- Node.js >= 18
- npm / pnpm

### 1. 配置环境变量

在 `sync-server` 目录下创建一个 `.env` 文件，填入你的 Token 和配置：

```env
# 必填：客户端同步密钥（最少 8 位）
SYNC_TOKEN="你的_SYNC_TOKEN"

# 选填：网页看板的访问密钥
DASHBOARD_TOKEN="你的_DASHBOARD_TOKEN"

# 选填：服务运行端口（默认 3000）
PORT=3000

# 选填：SQLite 数据库保存路径（默认在当前目录生成 folia-sync.db）
DB_PATH="./folia-sync.db"
```

### 2. 安装并启动

```bash
cd sync-server
npm install
npm run start:node
```

你可以使用 PM2 或 Docker 来进行持久化管理。

---

## 方案二：Cloudflare D1 部署

零成本、免服务器的 Serverless 部署。

### 前置要求
- 注册 Cloudflare 账号
- 安装 Wrangler: `npm install -g wrangler`
- 登录 Wrangler: `wrangler login`

### 1. 创建数据库

首先创建一个 D1 数据库实例：

```bash
wrangler d1 create folia-sync
```

命令执行后，终端会输出 `database_id`。

### 2. 配置部署信息

复制一份本地配置模板：

```bash
cp wrangler.toml wrangler.local.toml
```

打开 `wrangler.local.toml`，将刚才获取的 `database_id` 填入配置中。
*(注：`wrangler.local.toml` 已经被 git 忽略，请不要提交你的 id。)*

### 3. 配置 Token 环境变量

由于 Cloudflare 不使用 `.env` 文件存储敏感密钥，你需要通过 Secret 命令注入：

```bash
# 设置同步密钥 (必填，>= 8位)
wrangler secret put SYNC_TOKEN --config wrangler.local.toml

# 设置看板密钥 (选填)
wrangler secret put DASHBOARD_TOKEN --config wrangler.local.toml
```

### 4. 部署服务

一切准备就绪后，推送代码至 Cloudflare 边缘网络：

```bash
npm run deploy:cf -- --config wrangler.local.toml
```

---

## 🖥 网页看板与跨端配置

如果你在部署时配置了 `DASHBOARD_TOKEN`，你可以通过浏览器访问隐藏看板：

**访问地址**: `http://你的服务域名/?token=你的_DASHBOARD_TOKEN`

如果 Token 正确，你将看到一个极简的状态看板，展示当前数据库中存储的主题数量和最近更新时间。此页面仅作信息展示，无任何敏感交互。
