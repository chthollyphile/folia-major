import React from 'react';
import { Button, Group, Row, type SettingsGroupDef } from '../../../modal/settings/kit';
import { useLoadCustomBackgroundAsset, useCustomBackgroundAssetStore } from './useCustomBackgroundAsset';

// src/components/visualizer/backgrounds/custom/CustomBackground.tsx
// Displays imported image or video media and provides controls to manage it.
const GROUP: SettingsGroupDef = { id: 'custom-background-media', titleKey: 'options.customBackgroundGroup' };

export const CustomBackground: React.FC = () => {
    useLoadCustomBackgroundAsset();
    const url = useCustomBackgroundAssetStore(state => state.url);
    const asset = useCustomBackgroundAssetStore(state => state.asset);
    return (
        <div className="absolute inset-0 z-0 overflow-hidden bg-black">
            {asset?.type === 'video' && url
                ? <video key={url} src={url} autoPlay loop muted playsInline className="h-full w-full object-cover" />
                : url && <img src={url} alt="" className="h-full w-full object-cover" />}
            <div className="pointer-events-none absolute inset-0 bg-black/20" />
        </div>
    );
};

export const CustomBackgroundSettings: React.FC<{ t: (key: string) => string }> = ({ t }) => {
    useLoadCustomBackgroundAsset();
    const asset = useCustomBackgroundAssetStore(state => state.asset);
    const importFile = useCustomBackgroundAssetStore(state => state.importFile);
    const clear = useCustomBackgroundAssetStore(state => state.clear);
    const inputRef = React.useRef<HTMLInputElement>(null);
    return (
        <Group def={GROUP}>
            <input ref={inputRef} type="file" accept="image/*,video/*,.webm,.ogv,.mp4" className="hidden" onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importFile(file);
            }} />
            <Row label={asset?.name ?? t('options.customBackgroundEmpty')}>
                <Button onClick={() => inputRef.current?.click()}>{t('options.customBackgroundChoose')}</Button>
                <Button variant="quiet" disabled={!asset} onClick={() => void clear()}>{t('options.customBackgroundClear')}</Button>
            </Row>
            <Row notice={t('options.customBackgroundHint')} />
        </Group>
    );
};
