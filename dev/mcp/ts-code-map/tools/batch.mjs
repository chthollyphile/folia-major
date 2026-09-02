// dev/mcp/ts-code-map/tools/batch.mjs

/**
 * 一次调用里跑多个工具。
 *
 * 存在的理由是实测出来的：服务端本身很快（63 次混合调用合计约 1.9 秒），但每次工具调用都要
 * 走一整个 agent 往返，往返开销比服务端计算高两个数量级。所以决定总耗时的是**调用次数**，
 * 不是单次快慢。一条 shell 命令能用管道和 && 塞进三四个动作，MCP 工具默认一次只答一个问题——
 * 这个工具把那个差距补上。
 *
 * 已经知道要问哪几个问题时，一律用它一次问完，不要连着发五次单独调用。
 */

const MAX_CALLS = 12;
/**
 * 每个子调用单独限额。整体截断会把靠后的子调用整个吞掉——调用方看不出自己少拿了东西，
 * 这比结果长更危险。所以宁可每个都截短一点，也要保证每个都露面。
 */
const MAX_CHARS_PER_CALL = 6000;

export default {
    name: 'batch',
    description:
        '一次执行多个 ts-code-map 工具调用，结果一起返回。'
        + '决定总耗时的是往返次数而不是单次快慢，所以只要你能一次想清楚要问什么，就用它——'
        + '比如同时 outline 三个文件再查两个符号的引用。最多 12 个调用。',
    inputSchema: {
        type: 'object',
        properties: {
            calls: {
                type: 'array',
                description: '要执行的调用列表，按顺序执行',
                items: {
                    type: 'object',
                    properties: {
                        tool: { type: 'string', description: '工具名（不能是 batch 自己）' },
                        args: { type: 'object', description: '该工具的参数' },
                    },
                    required: ['tool'],
                },
            },
        },
        required: ['calls'],
    },
    async run(ctx, { calls }) {
        if (!Array.isArray(calls) || calls.length === 0) return 'calls 不能为空。';
        if (calls.length > MAX_CALLS) {
            return `一次最多 ${MAX_CALLS} 个调用，收到 ${calls.length} 个。拆成两批。`;
        }

        const chunks = [];
        for (const [index, call] of calls.entries()) {
            const label = `[${index + 1}/${calls.length}] ${call.tool} ${JSON.stringify(call.args ?? {})}`;
            if (call.tool === 'batch') {
                chunks.push(`${label}\nbatch 不能嵌套。`);
                continue;
            }
            try {
                const result = await ctx.runTool(call.tool, call.args ?? {});
                const clipped = result.length > MAX_CHARS_PER_CALL
                    ? `${result.slice(0, MAX_CHARS_PER_CALL)}\n…（本条结果过长已截断，单独调用 ${call.tool} 可看全）`
                    : result;
                chunks.push(`${label}\n${clipped}`);
            } catch (error) {
                // 单个调用失败不该让整批作废——其余结果通常还是有用的。
                chunks.push(`${label}\n错误: ${error.message}`);
            }
        }
        return chunks.join('\n\n────────────────────\n\n');
    },
};
