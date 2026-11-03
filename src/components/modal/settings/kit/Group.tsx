import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsAnchor } from '../navigation/SettingsAnchorContext';
import type { SettingsGroupDef } from './options';

// src/components/modal/settings/kit/Group.tsx
// A group of rows: a small heading over one card. The group registers as a settings anchor, which
// gives it a tab in the page header and makes it a place a link or a search hit can land.

/** The card rows sit in; the folded group draws the same one. st-card is what a row's hairline looks for. */
export const GROUP_CARD_CLASS = 'st-card overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]';

/** Space above a group; the first one on a page sits a little closer, under the header's hairline. */
export const GROUP_SPACING_CLASS = 'mt-7 first:mt-5';

type GroupProps = {
    def: SettingsGroupDef;
    /** No heading: for a group that is one leading option. */
    bare?: boolean;
    /** Sits at the right end of the heading line. */
    action?: React.ReactNode;
    /** A live picture of what the group's options do, drawn by the page: a strip at the top of the card. */
    preview?: React.ReactNode;
    /** One quiet line under the card, for something that holds for the whole group. */
    foot?: React.ReactNode;
    children: React.ReactNode;
};

export const Group: React.FC<GroupProps> = ({ def, bare, action, preview, foot, children }) => {
    const { t } = useTranslation();
    const title = t(def.titleKey);

    return (
        <SettingsAnchor anchorId={def.id} label={title} className={GROUP_SPACING_CLASS}>
            {!bare && (
                <div className="mb-2 flex min-h-6 items-center justify-between gap-3 px-1">
                    <h3 className="text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">{title}</h3>
                    {action}
                </div>
            )}
            <div className={GROUP_CARD_CLASS}>
                {preview && (
                    <div aria-hidden className="relative m-3 h-[136px] overflow-hidden rounded-lg bg-[var(--st-pv)]">
                        {preview}
                    </div>
                )}
                {children}
            </div>
            {foot && <p className="mx-1 mt-2 text-xs leading-[18px] text-[color:var(--st-t3)]">{foot}</p>}
        </SettingsAnchor>
    );
};

export default Group;
