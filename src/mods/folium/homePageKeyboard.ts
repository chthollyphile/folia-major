import { effectiveKeyCode } from '../../utils/keyboardTargets';
import { isPrimaryModifierPressed, isSecondaryModifierPressed } from '../../utils/platform';

// src/mods/folium/homePageKeyboard.ts
// Keep the global palette entry reachable while page widgets own other keys and focus.
export const isHomePaletteShortcut = (event: KeyboardEvent) => (
    (effectiveKeyCode(event) === 'KeyK' || event.key.toLowerCase() === 'k')
    && isPrimaryModifierPressed(event) && !isSecondaryModifierPressed(event) && !event.altKey && !event.shiftKey
);
/** Include nested mod shadow roots, skipping hidden and inert subtrees. */
export const homePageFocusTargets = (root: ParentNode): HTMLElement[] => [...root.children].flatMap(element => {
    if (element.matches('[inert], [hidden]')) return [];
    const own = element instanceof HTMLElement && element.tabIndex >= 0 && !element.matches(':disabled')
        && element.getClientRects().length && getComputedStyle(element).visibility === 'visible' ? [element] : [];
    return [...own, ...homePageFocusTargets(element.shadowRoot ?? element)];
});
/** Browser activeElement is retargeted at each shadow boundary. */
export const homePageActiveElement = (): Element | null => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
};
