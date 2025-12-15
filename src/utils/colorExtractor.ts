
interface RGB {
    r: number;
    g: number;
    b: number;
}

export const extractColors = async (imageUrl: string, count: number = 5): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve([]);
                return;
            }

            // Resize for performance
            const width = 50;
            const height = 50;
            canvas.width = width;
            canvas.height = height;

            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height).data;
            const colors: RGB[] = [];

            // Improved sampling: step = 2 instead of 5 for better coverage
            const step = 2;
            for (let i = 0; i < imageData.length; i += 4 * step) {
                const r = imageData[i];
                const g = imageData[i + 1];
                const b = imageData[i + 2];
                const a = imageData[i + 3];

                if (a < 128) continue; // Skip transparent

                // Calculate saturation and brightness
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const l = (max + min) / 2;
                const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));

                // Prefer colors with some saturation (avoid pure grays)
                // and exclude very dark or very bright colors
                if (saturation > 0.2 && l > 30 && l < 220) {
                    colors.push({ r, g, b });
                } else if (colors.length < 100) {
                    // Still collect some low-saturation colors as fallback
                    colors.push({ r, g, b });
                }
            }

            // Sort by saturation (vibrant colors first)
            colors.sort((a, b) => {
                const satA = (Math.max(a.r, a.g, a.b) - Math.min(a.r, a.g, a.b)) / 255;
                const satB = (Math.max(b.r, b.g, b.b) - Math.min(b.r, b.g, b.b)) / 255;
                return satB - satA;
            });

            // Extract distinct colors with lower distance threshold
            const distinctColors: RGB[] = [];
            const minDistance = 20; // Reduced from 30 for more variety

            for (const c of colors) {
                if (distinctColors.length >= count) break;

                const isDistinct = distinctColors.every(dc => {
                    const d = Math.sqrt(
                        Math.pow(c.r - dc.r, 2) +
                        Math.pow(c.g - dc.g, 2) +
                        Math.pow(c.b - dc.b, 2)
                    );
                    return d > minDistance;
                });

                if (isDistinct || distinctColors.length === 0) {
                    distinctColors.push(c);
                }
            }

            // If we don't have enough, fill with existing or transparent
            const result = distinctColors.map(c => `rgb(${c.r}, ${c.g}, ${c.b})`);
            resolve(result);
        };

        img.onerror = (e) => {
            console.warn("Failed to load image for color extraction", e);
            resolve([]);
        };
    });
};
