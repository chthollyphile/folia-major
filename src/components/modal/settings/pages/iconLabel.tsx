import React from 'react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/settings/pages/iconLabel.tsx
// A row's label with an icon before it, for the link rows of the Help page and of the 遇到问题？
// dialog it opens. The kit's Row has no icon of its own.

export const iconLabel = (Icon: LucideIcon, text: string): React.ReactNode => (
    <span className="flex items-center gap-2.5">
        <Icon size={16} className="shrink-0 text-[color:var(--st-t2)]" />
        {text}
    </span>
);
