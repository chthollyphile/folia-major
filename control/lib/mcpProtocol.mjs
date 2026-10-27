// control/lib/mcpProtocol.mjs
// Model Context Protocol (JSON-RPC 2.0, one message per line) over stdio for the Folia control
// API. tools/list is generated from shared/controlCatalog.mjs; tools/call goes through the
// HTTP/CDP transport. stdout carries protocol messages only, diagnostics go to stderr.

import readline from 'node:readline';
import {
    CONTROL_MCP_PROTOCOL_VERSION,
    CONTROL_SERVER_NAME,
    CONTROL_SERVER_VERSION,
    CONTROL_TOOLS,
} from '../../shared/controlCatalog.mjs';

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;

const STATE_RESOURCE = {
    uri: 'folia://state',
    name: 'Folia state snapshot',
    description: 'The full control-readable app state: playback, queue, volume, visualizer, theme, lyrics and providers.',
    mimeType: 'application/json',
};

const SERVER_INSTRUCTIONS = [
    'Folia is a music player. Use folia_status first to see what is playing, folia_search to find songs,',
    'folia_play_search or folia_play to start one, and folia_state for the full snapshot.',
    'folia_events with waitMs long-polls for playback/UI changes; folia_palette_list exposes every app command.',
].join(' ');

function jsonRpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) {
        error.data = data;
    }
    return { jsonrpc: '2.0', id: id ?? null, error };
}

/** The tools exposed to an MCP client: everything in the catalog except the eval escape hatch. */
export function exposedTools({ allowEval = false } = {}) {
    return CONTROL_TOOLS.filter(tool => allowEval || tool.name !== 'folia_eval');
}

/** Catalog tool -> MCP tool descriptor (schema passed through unchanged). */
export function toMcpTool(tool) {
    return {
        name: tool.name,
        title: tool.title,
        description: tool.description ?? tool.summary ?? '',
        inputSchema: tool.inputSchema,
        annotations: {
            readOnlyHint: Boolean(tool.readOnly),
            destructiveHint: Boolean(tool.destructive),
        },
    };
}

function isImageData(data) {
    return Boolean(
        data
        && typeof data === 'object'
        && typeof data.base64 === 'string'
        && data.base64.length > 0
        && String(data.mimeType ?? 'image/png').startsWith('image/'),
    );
}

/** Control envelope -> MCP tools/call result (screenshot becomes image content). */
export function envelopeToToolResult(envelope) {
    if (!envelope || envelope.ok !== true) {
        const error = envelope?.error ?? {};
        return {
            content: [{
                type: 'text',
                text: `${error.code ?? 'internal'}: ${error.message ?? 'the control call failed'}`,
            }],
            isError: true,
        };
    }
    const data = envelope.data ?? {};
    if (isImageData(data)) {
        const meta = {};
        if (data.width !== undefined) {
            meta.width = data.width;
        }
        if (data.height !== undefined) {
            meta.height = data.height;
        }
        if (data.path !== undefined) {
            meta.path = data.path;
        }
        return {
            content: [
                { type: 'image', data: data.base64, mimeType: data.mimeType ?? 'image/png' },
                { type: 'text', text: JSON.stringify(meta) },
            ],
            isError: false,
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: false,
    };
}

/**
 * Build the JSON-RPC request handler. `transport` is the object from transport.mjs; tests can
 * pass a fake one. The handler never throws for protocol errors, it returns JSON-RPC errors.
 */
export function createMcpHandler({ transport, allowEval = false } = {}) {
    const tools = exposedTools({ allowEval });
    const toolByName = new Map(tools.map(tool => [tool.name, tool]));

    function initializeResult() {
        return {
            protocolVersion: CONTROL_MCP_PROTOCOL_VERSION,
            capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false, subscribe: false },
                logging: {},
            },
            serverInfo: { name: CONTROL_SERVER_NAME, version: CONTROL_SERVER_VERSION },
            instructions: SERVER_INSTRUCTIONS,
        };
    }

    async function readResource(uri) {
        if (uri !== STATE_RESOURCE.uri) {
            return null;
        }
        const state = await transport.state();
        return {
            contents: [{
                uri: STATE_RESOURCE.uri,
                mimeType: 'application/json',
                text: JSON.stringify(state, null, 2),
            }],
        };
    }

    async function handleMessage(message) {
        if (Array.isArray(message)) {
            return jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request: batches are not supported');
        }
        if (!message || typeof message !== 'object') {
            return jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request');
        }
        const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
        const id = hasId ? message.id : null;
        const isNotification = !hasId;

        if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
            if (isNotification) {
                return null;
            }
            return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC 2.0 request object');
        }

        try {
            switch (message.method) {
                case 'initialize':
                    return isNotification ? null : jsonRpcResult(id, initializeResult());
                case 'notifications/initialized':
                case 'notifications/cancelled':
                case 'notifications/roots/list_changed':
                    return null;
                case 'ping':
                    return isNotification ? null : jsonRpcResult(id, {});
                case 'logging/setLevel':
                    return isNotification ? null : jsonRpcResult(id, {});
                case 'tools/list':
                    return isNotification ? null : jsonRpcResult(id, { tools: tools.map(toMcpTool) });
                case 'tools/call': {
                    if (isNotification) {
                        return null;
                    }
                    const params = message.params;
                    if (!params || typeof params !== 'object') {
                        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: tools/call expects { name, arguments }');
                    }
                    const name = params.name;
                    if (typeof name !== 'string' || name.length === 0) {
                        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: tools/call needs a tool name');
                    }
                    if (!toolByName.has(name)) {
                        const hint = name === 'folia_eval' && !allowEval
                            ? ' (folia_eval is only exposed when the server runs with --allow-eval)'
                            : '';
                        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, `Unknown tool: ${name}${hint}`, { tool: name });
                    }
                    const callArgs = params.arguments;
                    if (callArgs !== undefined && (callArgs === null || typeof callArgs !== 'object' || Array.isArray(callArgs))) {
                        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: arguments must be an object');
                    }
                    let envelope;
                    try {
                        envelope = await transport.invoke(name, callArgs ?? {});
                    } catch (error) {
                        return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, error?.message ?? String(error), error?.hint ? { hint: error.hint } : undefined);
                    }
                    return jsonRpcResult(id, envelopeToToolResult(envelope));
                }
                case 'resources/list':
                    return isNotification ? null : jsonRpcResult(id, { resources: [STATE_RESOURCE] });
                case 'resources/read': {
                    if (isNotification) {
                        return null;
                    }
                    const uri = message.params?.uri;
                    if (typeof uri !== 'string' || uri.length === 0) {
                        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: resources/read needs a uri');
                    }
                    try {
                        const contents = await readResource(uri);
                        if (!contents) {
                            return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, `Unknown resource: ${uri}`, { uri });
                        }
                        return jsonRpcResult(id, contents);
                    } catch (error) {
                        return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, error?.message ?? String(error), error?.hint ? { hint: error.hint } : undefined);
                    }
                }
                default:
                    return isNotification
                        ? null
                        : jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`);
            }
        } catch (error) {
            if (isNotification) {
                return null;
            }
            return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, `Internal error: ${error?.message ?? String(error)}`);
        }
    }

    return { handleMessage, tools, toolByName };
}

/**
 * Serve MCP over stdio. Lines are processed in order; the promise resolves after stdin closes and
 * every queued response has been written.
 */
export async function runStdioMcpServer({
    transport,
    allowEval = false,
    input = process.stdin,
    output = process.stdout,
    error = process.stderr,
} = {}) {
    const handler = createMcpHandler({ transport, allowEval });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let queue = Promise.resolve();
    let closed = false;

    function writeMessage(message) {
        return new Promise(resolve => {
            try {
                output.write(`${JSON.stringify(message)}\n`, () => resolve());
            } catch {
                resolve();
            }
        });
    }

    async function processLine(line) {
        const trimmed = String(line).trim();
        if (!trimmed) {
            return;
        }
        let message;
        try {
            message = JSON.parse(trimmed);
        } catch {
            await writeMessage(jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error: stdin must contain one JSON-RPC message per line'));
            return;
        }
        const response = await handler.handleMessage(message);
        if (response) {
            await writeMessage(response);
        }
    }

    lines.on('line', line => {
        queue = queue.then(() => processLine(line)).catch(cause => {
            if (!closed) {
                error.write(`[MCP] unhandled message error: ${cause?.message ?? cause}\n`);
            }
        });
    });
    lines.on('close', () => {
        closed = true;
    });

    await new Promise(resolve => {
        if (closed) {
            resolve();
            return;
        }
        lines.once('close', resolve);
    });
    await queue;
    try {
        await transport.close?.();
    } catch {
        // Closing is best effort.
    }
    return handler;
}
