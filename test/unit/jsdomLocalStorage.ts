// test/unit/jsdomLocalStorage.ts
// jsdom 单测的 localStorage 垫片（vitest setupFiles）。Node 25 起自带实验性的 Web Storage：
// 没传 --localstorage-file 时 globalThis.localStorage 是一个返回 undefined 的占位，
// 又因为这个 key 已经在 global 上，vitest 的 jsdom 环境不会用 jsdom 的那份盖掉它，
// store 和 i18n 在导入时一读就抛。这里在 jsdom 环境里一律换成内存实现（不读占位，免得 Node 打实验性警告），
// 各 Node 版本上的行为就一致了；node 环境不动。

if (typeof document !== 'undefined') {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
}
