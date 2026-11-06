import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClientProfiles } from './clientProfiles.mjs';
import { root } from './content.mjs';

// Export snippets for review and merging; never replace a host's existing configuration.
export async function exportClients(out, options = {}) {
    const profiles = createClientProfiles(options);
    await mkdir(out, { recursive: true });
    for (const [name, text] of Object.entries(profiles)) await writeFile(path.join(out, name), text);
    await writeFile(path.join(out, 'README.md'), '# Folium MCP 客户端配置\n\n只合并 folium-authoring 条目，不覆盖宿主配置。片段包含当前 Node 和入口的绝对路径，移动后重新生成。\n\nCodex 使用 TOML；Claude Code/Desktop、WorkBuddy 使用对应 JSON；DeepSeek Harness 将 YAML 插件项合并到 profile（不是 mcpServers JSON）。默认 stdio，HTTP 仅本机共享，双方需设置 FOLIUM_MCP_TOKEN，片段只含环境变量引用。未安装宿主的配置只经过 SDK 互通测试，不代表其界面/模型实测。\n\n先调用 folium_brief，再用 folium_read_guide 读 quickstart、api、specification；分页继续到 nextLine 为 null。详见 docs/folium/mcp.md。\n');
    return Object.keys(profiles);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.length > 2) throw new Error('Usage: exportClients.mjs [output-directory] [local-http-url]');
        const out = path.resolve(args[0] ?? path.join(root, 'dist-folium-mcp-clients'));
        console.info(`[FoliumMCP] Exported ${(await exportClients(out, args[1] ? { url: args[1] } : {})).length} profiles to ${out}`);
    } catch (error) { console.error('[FoliumMCP] Configuration export failed.', error); process.exitCode = 1; }
}
