import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClientProfiles } from './clientProfiles.mjs';
import { root, installation } from './content.mjs';

// Export reviewable snippets; installation/merging belongs to each host's supported setup flow.
export async function exportClients(out, options = {}) {
    const profiles = createClientProfiles(options);
    await mkdir(out, { recursive: true });
    for (const [name, text] of Object.entries(profiles)) await writeFile(path.join(out, name), text);
    const guide = `# Folia MCP 客户端配置\n\n这些是针对当前机器生成的配置片段，含 Node 和源码绝对路径，迁移后须重新生成。合并 folia-style 条目，不要覆盖现有客户端配置。\n\n- Codex：合并 codex.stdio.toml 到 Codex 配置，或按仓库文档用 codex mcp add。\n- Claude Code：将 claude-code.stdio.json 的条目合入项目 .mcp.json，或用 claude mcp add。\n- Claude Desktop：合并 claude-desktop.stdio.json 到桌面版 MCP 配置。此处未提供云端 Claude 网页连接器。\n- WorkBuddy：在其 MCP 自定义配置入口导入 workbuddy.stdio.json；HTTP 的类型名为 streamableHttp。\n- DeepSeek Harness：将 YAML 的单项并入部署 profile 的插件列表；使用官方 @deepseek-ai/dsh-mcp-client，不是 DeepSeek 聊天网页。\n\n默认推荐 stdio。HTTP 仅用于同机共享服务，先给服务端和客户端设置同一 FOLIA_MCP_TOKEN（32–256 位随机 URL-safe 字符）。配置只有变量引用，不含令牌值。Claude Code / WorkBuddy 需按各自环境变量规则提供该变量，不能把占位符当成实际令牌。\n\n诊断命令（在 Folia 仓库内运行）：\n\n    npm run style:mcp:doctor\n    npm run style:mcp:doctor -- --http http://127.0.0.1:43197/mcp\n\n服务启动：\n\n    node dev/stylePacks/mcp/server.mjs\n    node dev/stylePacks/mcp/server.mjs --http 43197\n\nHTTP 诊断同样从 FOLIA_MCP_TOKEN 读取令牌。所有客户端先调用 folia_style_brief；不支持资源/Prompt 时用 folia_style_read_guide 获取 renderer-api 等完整契约。详细说明见仓库 docs/style-pack-mcp.md。\n`;
    const installedGuide = `# Folia MCP 客户端配置\n\n这些片段已指向当前安装内的 Node 和服务，不依赖源码目录。只合并 folia-style 条目，不要覆盖宿主整个配置文件。移动安装目录后须重新导出。\n\nPowerShell：\n\n    & ${JSON.stringify(installation.cli)} self-test\n    & ${JSON.stringify(installation.cli)} connect-codex\n\nClaude Code/Desktop、WorkBuddy 用对应 JSON；DeepSeek Harness 把 YAML 插件项合入部署 profile；generic 供其他 stdio 客户端。HTTP 需要双方使用相同的 FOLIA_MCP_TOKEN，配置只含变量引用。完整使用说明见安装目录 README.md。\n`;
    await writeFile(path.join(out, 'README.md'), installation.mode === 'standalone' ? installedGuide : guide);
    return Object.keys(profiles);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.length > 2) throw new Error('Usage: exportClients.mjs [output-directory] [local-http-url]');
        const out = path.resolve(args[0] ?? path.join(root, 'dist-style-mcp-clients'));
        const files = await exportClients(out, args[1] ? { url: args[1] } : {});
        console.info(`[FoliaMCP] Exported ${files.length} client profiles to ${out}`);
    } catch (error) { console.error('[FoliaMCP] Configuration export failed.', error); process.exitCode = 1; }
}
