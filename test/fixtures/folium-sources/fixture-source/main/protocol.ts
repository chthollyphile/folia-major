// test/fixtures/folium-sources/fixture-source/main/protocol.ts
// main 入口与它的 worker 之间来回的消息。

export interface WorkerQuestion {
    id: number;
    query: string;
}

export interface WorkerAnswer {
    id: number;
    from: string;
}
