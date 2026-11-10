import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { useNativeTrafficLights } from './useNativeTrafficLights';

// Whether the window's own buttons sit in the top-left corner: the drawn ones moved to the left,
// or the macOS traffic lights. Pages lower their back button out of the way while this is true.
export const useWindowButtonsAtTopLeft = (): boolean => {
    const side = usePlayerChromeSettingsStore(state => state.titlebarSide);
    const nativeTrafficLights = useNativeTrafficLights();
    return typeof window !== 'undefined' && Boolean(window.electron) && (side === 'left' || nativeTrafficLights);
};
