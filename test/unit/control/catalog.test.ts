import { describe, expect, it } from 'vitest';
import {
    CONTROL_DANGEROUS_TOOL_NAMES,
    CONTROL_ERROR_CODES,
    CONTROL_EVENT_TYPES,
    CONTROL_GROUPS,
    CONTROL_MAIN_TOOL_NAMES,
    CONTROL_MCP_PROTOCOL_VERSION,
    CONTROL_SERVER_NAME,
    CONTROL_TOOL_NAMES,
    CONTROL_TOOLS,
    DEFAULT_CONTROL_PORT,
    getControlTool,
} from '../../../shared/controlCatalog.mjs';

// test/unit/control/catalog.test.ts
// Invariants of the control catalog: the single source of truth every control surface is built
// from. A broken catalog is a broken CLI, MCP server and renderer bridge at once, so the shape is
// pinned here rather than discovered at runtime.

const EXPECTED_GROUPS = [
    'system', 'palette', 'search', 'playback', 'queue', 'lyrics',
    'visualizer', 'settings', 'navigation', 'library', 'window', 'events',
];

describe('control catalog', () => {
    it('declares unique, namespaced tool names', () => {
        const names = CONTROL_TOOLS.map(tool => tool.name);
        expect(new Set(names).size).toBe(names.length);
        expect(CONTROL_TOOL_NAMES.size).toBe(names.length);
        names.forEach(name => {
            expect(name).toMatch(/^folia_[a-z0-9]+(_[a-z0-9]+)*$/);
        });
    });

    it('keeps every tool self-describing', () => {
        CONTROL_TOOLS.forEach((tool) => {
            expect(tool.title.length).toBeGreaterThan(2);
            expect(tool.summary.length).toBeGreaterThan(10);
            expect(tool.description.length).toBeGreaterThan(tool.summary.length);
            expect(EXPECTED_GROUPS).toContain(tool.group);
            expect(['bridge', 'main']).toContain(tool.executor);
        });
    });

    it('declares a closed object schema whose required fields exist', () => {
        CONTROL_TOOLS.forEach((tool) => {
            const schema = tool.inputSchema as {
                type?: string;
                properties?: Record<string, unknown>;
                required?: string[];
                additionalProperties?: boolean;
            };
            expect(schema.type, tool.name).toBe('object');
            expect(schema.additionalProperties, tool.name).toBe(false);
            expect(schema.properties, tool.name).toBeTruthy();
            (schema.required ?? []).forEach((key) => {
                expect(schema.properties, `${tool.name} required ${key}`).toHaveProperty(key);
            });
        });
    });

    it('splits executors the way the server expects', () => {
        // The Electron main process owns exactly these; everything else runs in the renderer.
        expect([...CONTROL_MAIN_TOOL_NAMES].sort()).toEqual(['folia_quit', 'folia_screenshot']);
        expect(CONTROL_TOOLS.filter(tool => tool.executor === 'main').every(tool => tool.destructive || tool.readOnly))
            .toBe(true);
    });

    it('marks the destructive escape hatches dangerous', () => {
        // Both can leave the app or its data in a state the user did not ask for.
        expect([...CONTROL_DANGEROUS_TOOL_NAMES].sort()).toEqual([
            'folia_queue_clear',
            'folia_quit',
        ]);
    });

    it('groups the catalog without stragglers', () => {
        expect([...CONTROL_GROUPS].sort()).toEqual([...EXPECTED_GROUPS].sort());
    });

    it('exposes the documented constants', () => {
        expect(CONTROL_EVENT_TYPES.length).toBeGreaterThan(5);
        expect(new Set(CONTROL_EVENT_TYPES).size).toBe(CONTROL_EVENT_TYPES.length);
        expect(CONTROL_ERROR_CODES.bad_request.length).toBeGreaterThan(5);
        expect(CONTROL_MCP_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(CONTROL_SERVER_NAME).toBe('folia-control');
        expect(DEFAULT_CONTROL_PORT).toBe(4567);
    });

    it('looks tools up by name and rejects unknown names', () => {
        expect(getControlTool('folia_volume')?.group).toBe('playback');
        expect(getControlTool('nope')).toBeNull();
    });
});
