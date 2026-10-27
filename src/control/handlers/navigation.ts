import { useAppViewStore } from '../../stores/useAppViewStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import type { PanelTab } from '../../components/UnifiedPanel';
import { ControlError, requireString, optionalBoolean } from '../errors';
import { closeCommandPaletteOverlay, isCommandPaletteOpen } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/navigation.ts
// Main view navigation, the unified side panel, the palette overlay, and the app toast.

export const navigationHandlers: Record<string, ControlHandler> = {
    folia_navigate: (args, deps) => {
        const view = requireString(args.view, 'view');
        switch (view) {
            case 'home':
                deps.context.navigation.navigateToHome();
                return { view: 'home' };
            case 'player':
                deps.context.navigation.navigateToPlayer();
                return { view: 'player' };
            case 'lattice':
                deps.context.navigation.navigateToLattice();
                return { view: 'lattice' };
            default:
                throw new ControlError('bad_request', `Unknown view "${view}"`, {
                    views: ['home', 'player', 'lattice'],
                });
        }
    },

    folia_panel: (args, deps) => {
        const tab = args.tab === undefined ? undefined : requireString(args.tab, 'tab');
        const open = optionalBoolean(args.open, 'open') ?? true;
        if (open === false) {
            deps.context.panel.setIsPanelOpen(false);
            return { open: false, tab: useAppViewStore.getState().panelTab };
        }
        if (tab !== undefined) {
            deps.context.panel.setPanelTab(tab as PanelTab);
        }
        deps.context.panel.setIsPanelOpen(true);
        return { open: true, tab: tab ?? useAppViewStore.getState().panelTab };
    },

    folia_palette_ui: (args) => {
        const action = requireString(args.action, 'action');
        if (action === 'open') {
            useAppViewStore.getState().requestCommandPalette('root');
        } else if (action === 'close') {
            closeCommandPaletteOverlay();
        } else {
            throw new ControlError('bad_request', `Unknown palette action "${action}"`);
        }
        return { action, open: isCommandPaletteOpen() };
    },

    folia_toast: (args) => {
        const text = requireString(args.text, 'text');
        const type = args.type === 'success' || args.type === 'error' ? args.type : 'info';
        const durationMs = typeof args.durationMs === 'number' ? args.durationMs : undefined;
        setStatusMessage({
            type,
            text,
            ...(durationMs !== undefined ? { durationMs } : {}),
            nonce: Date.now(),
        });
        return { shown: true, type, ...(durationMs !== undefined ? { durationMs } : {}) };
    },
};
