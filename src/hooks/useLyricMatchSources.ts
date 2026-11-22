import type { LyricProviderSource } from '../types';
import { useCrossSourceParticipants } from './useCrossSourceParticipants';

// src/hooks/useLyricMatchSources.ts
// The lyric sources on offer now: the tabs of the match dialogs and the choices of the priority
// setting. Which ones take part is crossSource.ts's rule: a source whose platform is not there is
// left out, and one that needs an account comes and goes with that account's sign-in.
export const useLyricMatchSources = (): LyricProviderSource[] => useCrossSourceParticipants('lyrics').ready;
