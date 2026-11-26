// dev/strokes-wgsl/node.ts
// The few Node / Electron APIs the test shell's renderer uses (nodeIntegration is on in main.cjs), typed
// narrowly so the harness needs no `any`.

export interface NodeFs {
    readFileSync(path: string): Uint8Array;
    readFileSync(path: string, encoding: 'utf8'): string;
    writeFileSync(path: string, data: string): void;
    openSync(path: string, flags: string): number;
    readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
}

export interface NodePath { join(...parts: string[]): string }

export interface Ipc {
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;

export const fs = nodeRequire('fs') as NodeFs;
export const path = nodeRequire('path') as NodePath;
export const ipcRenderer = (nodeRequire('electron') as { ipcRenderer: Ipc }).ipcRenderer;
