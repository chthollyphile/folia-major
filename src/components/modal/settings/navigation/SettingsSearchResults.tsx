import React from 'react';
import { GROUP_CARD_CLASS, GROUP_SPACING_CLASS } from '../kit/Group';
import { Row } from '../kit/Row';
import { Value } from '../kit/Value';
import type { SettingsSearchEntry } from './settingsNavSearch';
// src/components/modal/settings/navigation/SettingsSearchResults.tsx
// What the settings search found: one row per hit, its place at the right. A click goes there.

type SettingsSearchResultsProps = {
    hits: SettingsSearchEntry[];
    onSelect: (hit: SettingsSearchEntry) => void;
};

export const SettingsSearchResults: React.FC<SettingsSearchResultsProps> = ({ hits, onSelect }) => (
    hits.length === 0 ? null : (
        <div className={`st-page-in ${GROUP_SPACING_CLASS} ${GROUP_CARD_CLASS}`}>
            {hits.map(hit => (
                <Row key={`${hit.sectionId}/${hit.targetId ?? ''}`} label={hit.label} onClick={() => onSelect(hit)}>
                    {hit.path && <Value>{hit.path}</Value>}
                </Row>
            ))}
        </div>
    )
);

export default SettingsSearchResults;
