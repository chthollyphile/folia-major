import { styleGroup } from './catalog';

// Keep the player popup and settings shelf on the same category labels and membership rules.
export const stylePickerGroups = (t: (key: string) => string) => [
    { id: 'personality', label: t('stylePacks.personality'), description: t('stylePacks.personalityHint') },
    { id: 'lyric-template', label: t('stylePacks.lyricTemplate'), description: t('stylePacks.lyricTemplateHint') },
    { id: 'other', label: t('stylePacks.other'), description: t('stylePacks.otherHint') },
];
export const withStyleGroup = <T extends { value: string }>(option: T) => ({ ...option, group: styleGroup(option.value) });
