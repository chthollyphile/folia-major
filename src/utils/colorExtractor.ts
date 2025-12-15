
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

            // Sample pixels with a step to be faster
            const step = 5;
            for (let i = 0; i < imageData.length; i += 4 * step) {
                const r = imageData[i];
                const g = imageData[i + 1];
                const b = imageData[i + 2];
                const a = imageData[i + 3];

                if (a < 128) continue; // Skip transparent

                // Simple saturation/brightness check to avoid gray/black/white if desired
                // But for album covers, maybe we want them? 
                // Let's filter out very dark or very bright to keep "color" unless it's strictly monochrome
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const l = (max + min) / 2;

                // Allow some range, but maybe skip pure black/white unless needed

                colors.push({ r, g, b });
            }

            // Simple clustering or just picking distinct ones
            const distinctColors: RGB[] = [];
            const minDistance = 30; // Min euclidean distance to be considered different

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
