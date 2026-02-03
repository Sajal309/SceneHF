import { ImgHTMLAttributes, useEffect, useState } from 'react';

interface ImageWithAspectBadgeProps extends ImgHTMLAttributes<HTMLImageElement> {
    wrapperClassName?: string;
    badgeClassName?: string;
    showOnHover?: boolean;
}

const ratioLabel = (width: number, height: number) => {
    if (!width || !height) return '';
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(width, height);
    return `${Math.round(width / d)}:${Math.round(height / d)}`;
};

export function ImageWithAspectBadge({
    wrapperClassName = '',
    badgeClassName = '',
    showOnHover = true,
    onLoad,
    src,
    ...imgProps
}: ImageWithAspectBadgeProps) {
    const [aspect, setAspect] = useState('');

    useEffect(() => {
        setAspect('');
    }, [src]);

    return (
        <div className={`relative group ${wrapperClassName}`}>
            <img
                {...imgProps}
                src={src}
                onLoad={(e) => {
                    const img = e.currentTarget;
                    setAspect(ratioLabel(img.naturalWidth, img.naturalHeight));
                    onLoad?.(e);
                }}
            />
            {aspect && (
                <span
                    className={`pointer-events-none absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/70 text-white border border-white/20 transition-opacity ${
                        showOnHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                    } ${badgeClassName}`}
                >
                    {aspect}
                </span>
            )}
        </div>
    );
}
