import React, { useMemo } from 'react';
import { renderSVG } from 'uqr';

// src/components/shared/QrCodeImage.tsx
// Renders a QR code for a text value as an inline SVG data URL (dark modules on a white quiet zone,
// so it scans regardless of the app theme).

type QrCodeImageProps = {
    value: string;
    alt: string;
    className?: string;
};

export const QrCodeImage: React.FC<QrCodeImageProps> = ({ value, alt, className }) => {
    const src = useMemo(() => {
        const svg = renderSVG(value, { border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }, [value]);

    return <img src={src} alt={alt} className={className} draggable={false} />;
};

export default QrCodeImage;
