import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Row, Select, TextField, type SettingsOptionDef } from '../../kit';
import { useAiModels } from './useAiModels';

// Uses the settings-kit picker, retaining manual entry for servers without model discovery.
const MANUAL = '__manual_model__';

export const AiModelPicker: React.FC<{
    option: SettingsOptionDef;
    payload: AiConnectionTestPayload;
    keySaved: boolean;
    presetId: string;
    /** The preset's suggestions, offered while there is no fetched list (none fetched yet, or it failed). */
    suggestedModels?: readonly string[];
    /** False for a provider with no listing request: suggestions and manual entry only, no fetch. */
    listsModels: boolean;
    /** The model a blank field stands for (the provider's default), shown in place of "select a model". */
    defaultModel?: string;
    onChange: (model: string) => void;
}> = ({ option, payload, keySaved, presetId, suggestedModels, listsModels, defaultModel, onChange }) => {
    const { t } = useTranslation();
    const list = useAiModels(payload, keySaved);
    const [manual, setManual] = useState(false);
    useEffect(() => setManual(false), [presetId]);
    const model = payload.model || '';
    const options = list.models.map(value => ({
        value: value.id,
        label: value.name === value.id ? value.id : value.name + ' · ' + value.id,
    }));
    // Without a list, what the main process suggested for this connection, else the preset's own.
    const suggestions = list.models.length ? [] : list.suggested.length ? list.suggested : suggestedModels ?? [];
    for (const id of suggestions) {
        if (!options.some(option => option.value === id)) options.push({ value: id, label: id });
    }
    if (model && !options.some(option => option.value === model)) options.unshift({ value: model, label: model });
    if (!model) options.unshift({ value: '', label: defaultModel ? t('options.aiModelDefault', { model: defaultModel }) : t('options.aiModelChoose') });
    options.push({ value: MANUAL, label: t('options.aiModelManual') });
    const errorKey = list.error === 'auth' ? 'aiModelsAuthError'
        : list.error === 'timeout' ? 'aiModelsTimeout'
            : list.error === 'empty' ? 'aiModelsEmpty'
                : 'aiModelsError';

    return (
        <>
            <Row option={option}>
                <Select
                    value={manual ? MANUAL : model}
                    options={options}
                    onOpen={() => { if (listsModels && !list.models.length) void list.load(); }}
                    onChange={value => {
                        setManual(value === MANUAL);
                        if (value !== MANUAL) onChange(value);
                    }}
                />
                {listsModels && (
                    <Button icon={RefreshCw} onClick={() => void list.load()} disabled={list.loading || !list.canLoad}>
                        {t(list.loading ? 'options.aiModelsLoading' : 'options.aiModelsFetch')}
                    </Button>
                )}
            </Row>
            {manual && (
                <Row sub label={t('options.aiModelManual')}>
                    <TextField value={model} onChange={onChange} placeholder={defaultModel || t('options.aiModelPlaceholder')} />
                </Row>
            )}
            {list.error && <Row notice={t('options.' + errorKey)} />}
        </>
    );
};
