# 通用配置模块 (Config Module)

## 现状调研与重构规划

### 1. 现状问题
当前系统存在以下配置管理问题：
- **分散管理**：配置散落在 `server-config.ts`、`api-config.ts`、`request-config.ts`、`user-info.ts` 多个文件中。
- **缺乏类型校验**：配置项使用原生对象或任意类型 (`any`)，未对环境变量或必填项进行强制校验（如 `PORT` 缺失可能导致异常）。
- **硬编码**：`user-info.ts` 存在硬编码的 `cookie` 和 `loginUin` 等用户状态相关的伪配置。
- **无监控审计**：未对配置变更进行跟踪记录，缺乏对敏感信息的保护和加载时性能优化。

### 2. 集中化管理结构规划
为了解决以上问题，重构后的配置模块采用集中式管理与 Zod 类型校验：

#### 目录结构
```
src/config/
├── README.md             # 配置模块说明文档
├── index.ts              # 集中式配置暴露入口（导出 ConfigManager）
├── schema.ts             # 使用 Zod 定义所有配置项的 Schema 与类型校验
├── default.ts            # 系统默认配置
└── manager.ts            # ConfigManager 核心实现（加载、校验、合并、审计、缓存）
```

#### 数据结构 (Config Interface)
配置模块最终对外暴露的数据结构如下：
```typescript
interface AppConfig {
  server: {
    port: number;
    cors: {
      exposeHeaders: string[];
      maxAge: number;
      credentials: boolean;
      allowMethods: string[];
      allowHeaders: string[];
    };
  };
  request: {
    timeout: number;
    withCredentials: boolean;
    contentType: string;
    responseType: string;
    baseURL: {
      y: string;
      c: string;
      u: string;
      pic: string;
    };
    referer: {
      y: string;
      c: string;
      u: string;
    };
  };
  api: {
    commonParams: Record<string, any>;
    options: Record<string, string>;
    optionsPrefix: Record<string, string>;
  };
  user: {
    loginUin: string;
    cookie: string;
  };
}
```

### 3. 命名规范与存放路径规范
- **文件命名**：使用全小写中划线分隔（`kebab-case`），例如 `server-config.ts` -> `server.ts`（若按模块拆分）。但重构后统一在 `manager.ts` 与 `schema.ts` 中处理。
- **变量/属性命名**：统一使用小驼峰（`camelCase`）。
- **存放路径**：所有全局应用级配置均存放在 `src/config/` 下，业务代码只能从 `src/config/index.ts` 导入 `config` 实例，禁止自行读取环境变量或硬编码魔术字符串。
