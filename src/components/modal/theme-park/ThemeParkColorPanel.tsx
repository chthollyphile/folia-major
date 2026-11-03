import React from 'react';
import { ThemeColorPickerCard, ThemeColorWells, ThemeModeSwitch } from './ThemeColorParts';
import type { ThemeParkEditor } from './useThemeParkDraft';

// src/components/modal/theme-park/ThemeParkColorPanel.tsx
// Color tab of the Theme Park editor: the light/dark switch, the four theme colours as wells, and
// one picker for the chosen well with its HEX field and the recommended swatches.

type ThemeParkColorPanelProps = {
    editor: ThemeParkEditor;
    recommendedColors: ReadonlyArray<string>;
};

const ThemeParkColorPanel: React.FC<ThemeParkColorPanelProps> = ({ editor, recommendedColors }) => {
    const activeTheme = editor.safeDraft[editor.mode];

    return (
        <div className="flex flex-col gap-3 pt-5">
            <ThemeModeSwitch mode={editor.mode} onChange={editor.setMode} />
            <ThemeColorWells theme={activeTheme} activeKey={editor.activeColorKey} onChange={editor.setActiveColorKey} />
            <ThemeColorPickerCard
                theme={activeTheme}
                activeKey={editor.activeColorKey}
                recommendedColors={recommendedColors}
                onDrag={editor.updateColorThrottled}
                onChange={editor.updateColorInstant}
            />
        </div>
    );
};

export default ThemeParkColorPanel;
