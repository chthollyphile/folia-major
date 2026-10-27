import type { ControlHostDeps } from './types';

// src/control/controlHostDeps.ts
// The exact dependency bag ControlHost receives from App.tsx (PROTOCOL §2.4). Kept in its own
// module so tests and handlers can name the contract without importing the React component.

export type { ControlHostDeps } from './types';

export type ControlHostProps = ControlHostDeps;

/**
 * App.tsx owns these values and recreates several callbacks on every render, so the host keeps one
 * live object and hands the bridge a getter rather than a snapshot.
 */
export const createControlHostDeps = (props: ControlHostProps): ControlHostDeps => props;
