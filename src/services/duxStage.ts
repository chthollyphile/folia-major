// src/services/duxStage.ts
// The Dux Stage source has its own loopback endpoint, separate from the Now Playing app's 9863.

export const DUX_STAGE_PORT = 9864;
export const DUX_STAGE_WS_URL = `ws://127.0.0.1:${DUX_STAGE_PORT}/api/ws/lyric`;
export const DUX_STAGE_PROGRESS_QUERY_URL = `http://127.0.0.1:${DUX_STAGE_PORT}/api/query/progress`;
