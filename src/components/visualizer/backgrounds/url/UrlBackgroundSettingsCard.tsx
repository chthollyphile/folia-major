import React, { useCallback, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { UrlBackgroundItem } from '../../../../types';
import { normalizeUrlBackgroundUrl } from '../../../../utils/urlBackground';
import { Button, Group, Row, Status, TextField, type SettingsGroupDef } from '../../../modal/settings/kit';

// src/components/visualizer/backgrounds/url/UrlBackgroundSettingsCard.tsx
// Manages the URL background list (add/edit/delete/select) as one group of the settings kit: a row
// for each page, whose name chooses it, and a last row that adds one.
const URL_GROUP: SettingsGroupDef = { id: 'bg-url', titleKey: 'options.urlBackgroundSettings' };

interface UrlBackgroundSettingsCardProps {
    t: (key: string) => string;
    urlBackgroundList?: UrlBackgroundItem[];
    urlBackgroundSelectedId?: string | null;
    onAddUrlBackgroundItem?: (item: UrlBackgroundItem) => void;
    onUpdateUrlBackgroundItem?: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    onDeleteUrlBackgroundItem?: (id: string) => void;
    onSetUrlBackgroundSelectedId?: (id: string | null) => void;
}

const generateId = () => `url-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const UrlBackgroundSettingsCard: React.FC<UrlBackgroundSettingsCardProps> = ({
    t,
    urlBackgroundList = [],
    urlBackgroundSelectedId = null,
    onAddUrlBackgroundItem,
    onUpdateUrlBackgroundItem,
    onDeleteUrlBackgroundItem,
    onSetUrlBackgroundSelectedId,
}) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftUrl, setDraftUrl] = useState('');
    const [draftNote, setDraftNote] = useState('');

    const resetDraft = useCallback(() => {
        setDraftUrl('');
        setDraftNote('');
        setIsAdding(false);
        setEditingId(null);
    }, []);

    const handleAdd = useCallback(() => {
        const trimmedUrl = normalizeUrlBackgroundUrl(draftUrl);
        if (!trimmedUrl) return;
        const item: UrlBackgroundItem = {
            id: generateId(),
            url: trimmedUrl,
            note: draftNote.trim() || trimmedUrl,
        };
        onAddUrlBackgroundItem?.(item);
        onSetUrlBackgroundSelectedId?.(item.id);
        resetDraft();
    }, [draftUrl, draftNote, onAddUrlBackgroundItem, onSetUrlBackgroundSelectedId, resetDraft]);

    const handleStartEdit = useCallback((item: UrlBackgroundItem) => {
        setIsAdding(false);
        setEditingId(item.id);
        setDraftUrl(item.url);
        setDraftNote(item.note);
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (!editingId) return;
        const trimmedUrl = normalizeUrlBackgroundUrl(draftUrl);
        if (!trimmedUrl) return;
        onUpdateUrlBackgroundItem?.(editingId, {
            url: trimmedUrl,
            note: draftNote.trim() || trimmedUrl,
        });
        resetDraft();
    }, [editingId, draftUrl, draftNote, onUpdateUrlBackgroundItem, resetDraft]);

    // The two fields of a page being added or changed, and the buttons that end it.
    const draftRow = (onSave: () => void) => (
        <Row
            below={(
                <div className="flex flex-col gap-2 [&>input]:w-full">
                    <TextField type="url" value={draftUrl} onChange={setDraftUrl} placeholder="https://example.com" />
                    <TextField value={draftNote} onChange={setDraftNote} placeholder={t('options.urlBackgroundNotePlaceholder')} />
                    <div className="flex justify-end gap-2">
                        <Button onClick={resetDraft}>{t('ui.cancel')}</Button>
                        <Button variant="primary" onClick={onSave} disabled={!draftUrl.trim()}>{t('options.save')}</Button>
                    </div>
                </div>
            )}
        />
    );

    return (
        <Group def={URL_GROUP} foot={t('options.urlBackgroundSettingsDesc')}>
            {urlBackgroundList.map(item => (editingId === item.id ? (
                <React.Fragment key={item.id}>{draftRow(handleSaveEdit)}</React.Fragment>
            ) : (
                <Row
                    key={item.id}
                    label={(
                        <button
                            type="button"
                            role="radio"
                            aria-checked={item.id === urlBackgroundSelectedId}
                            onClick={() => onSetUrlBackgroundSelectedId?.(item.id)}
                            className="flex w-full min-w-0 items-center gap-2.5 rounded text-left"
                        >
                            <span
                                aria-hidden
                                className={`st-t-fast h-4 w-4 shrink-0 rounded-full transition-shadow ${item.id === urlBackgroundSelectedId ? 'shadow-[inset_0_0_0_5px_var(--st-accent)]' : 'shadow-[inset_0_0_0_1.5px_var(--st-t3)]'}`}
                            />
                            <span className="min-w-0">
                                <span className="block truncate">{item.note}</span>
                                <span className="block truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{item.url}</span>
                            </span>
                        </button>
                    )}
                >
                    <Button icon={Pencil} tip={t('options.urlBackgroundEdit')} onClick={() => handleStartEdit(item)} />
                    <Button icon={Trash2} tip={t('options.urlBackgroundDelete')} onClick={() => onDeleteUrlBackgroundItem?.(item.id)} />
                </Row>
            )))}

            {isAdding ? draftRow(handleAdd) : (
                <Row label={urlBackgroundList.length === 0 ? <Status>{t('options.urlBackgroundEmpty')}</Status> : undefined}>
                    <Button
                        icon={Plus}
                        onClick={() => {
                            setEditingId(null);
                            setDraftUrl('');
                            setDraftNote('');
                            setIsAdding(true);
                        }}
                    >
                        {t('options.urlBackgroundAdd')}
                    </Button>
                </Row>
            )}
        </Group>
    );
};

export { UrlBackgroundSettingsCard };
