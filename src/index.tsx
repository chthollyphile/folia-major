import { Buffer } from 'buffer';
import { installGlobalVisualizerFrameRateLimiter } from './utils/frameRateLimiter';
// @ts-ignore
globalThis.Buffer = Buffer;
installGlobalVisualizerFrameRateLimiter();

void import('./bootstrap');
