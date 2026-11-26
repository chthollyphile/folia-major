/// <reference types="@webgpu/types" />
import type { RefData } from './refData';

// dev/strokes-wgsl/ownChecks.ts
// own1 checks of the test shell against the reference (as tools/mnn main.cpp checkOwn1).

export const runOwnChecks = async (_device: GPUDevice, _config: unknown, _ref: RefData, _report: Record<string, unknown>, log: (line: string) => void): Promise<void> => {
    log('own1: not built yet');
};
