import React from 'react';
import { openOutsideLink, opensThroughDesktopApp } from '../../../../utils/system/outsideLink';

// src/components/modal/settings/kit/Link.tsx
// A link to a page outside the app, inside a sentence: in a row's hint or note, or in a group's
// foot. It takes the size and colour of the text around it and is marked by an underline.

type LinkProps = {
    href: string;
    children: React.ReactNode;
};

export const Link: React.FC<LinkProps> = ({ href, children }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
            if (opensThroughDesktopApp()) {
                event.preventDefault();
                void openOutsideLink(href);
            }
        }}
        className="st-t-fast rounded-[3px] underline decoration-[var(--st-line2)] underline-offset-2 transition-colors hover:text-[color:var(--st-t1)] hover:decoration-current"
    >
        {children}
    </a>
);

export default Link;
