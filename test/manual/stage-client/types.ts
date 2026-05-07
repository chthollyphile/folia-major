// Shared manual stage-client types keep the DOM entry file smaller and easier to reason about.

export type ResponseTarget = 'health' | 'clear' | 'session';
export type Direction = 'in' | 'out' | 'http' | 'system';
export type SocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ManagedInstance = {
    id: string;
    baseUrl: string;
    token: string;
    controllerId: string;
    selected: boolean;
    socket: WebSocket | null;
    socketStatus: SocketStatus;
    playerId: string | null;
    lastEvent: string;
    lastMessageType: string | null;
    lastResponse: string;
    lastServerHello: unknown;
    lastHelloAck: unknown;
};

export type EventLogEntry = {
    id: string;
    at: number;
    instanceId: string;
    label: string;
    direction: Direction;
    title: string;
    body: string;
};
