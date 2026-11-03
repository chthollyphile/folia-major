// test/unit/jsdomLocalStorage.ts
// 单测的 localStorage 垫片（vitest setupFiles）。Node 25 起自带实验性的 Web Storage：
// 没传 --localstorage-file 时 globalThis.localStorage 是一个占位（Node 25 上是没有方法的空对象，Node 26 上是 undefined），
// 又因为这个 key 已经在 global 上，vitest 的 jsdom 环境不会用 jsdom 的那份盖掉它，
// store 和 i18n 在导入时一读就抛。这里在 jsdom 环境里一律换成内存实现（不读占位，免得 Node 打实验性警告）；
// node 环境把占位删掉，和 Node 24 上一样没有 localStorage（`typeof localStorage === 'undefined'` 的守卫才拦得住），
// delete 不经过占位的 getter，也不打警告。各 Node 版本上的行为就一致了。

if (typeof document !== 'undefined') {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(String(key)) ? entries.get(String(key))! : null),
            setItem: (key: string, value: string) => { entries.set(String(key), String(value)); },
            removeItem: (key: string) => { entries.delete(String(key)); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
} else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
}
