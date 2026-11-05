// Public setup metadata. Saved credentials are never returned over IPC.
export interface SoloistBuild {
    path: string;
    state: 'missing' | 'invalid' | 'unknown' | 'clock-warning' | 'valid' | 'expiring' | 'expired';
    version: string | null;
    builtAt?: number;
    expiresAt?: number;
    daysRemaining?: number | null;
}
export interface SoloistStatus {
    configured: boolean;
    keyState: 'missing' | 'locked' | 'unreadable' | 'available';
    binary: SoloistBuild;
    running: boolean;
    connected: boolean;
    active?: boolean;
    error?: string;
}
export interface SoloistResult {
    ok?: boolean;
    saved?: boolean;
    canceled?: boolean;
    message?: string;
}
