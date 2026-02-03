import { useState, useEffect } from 'react';
import { Job as JobType, Step, api } from '../lib/api';
import { UpdateIcon, DownloadIcon } from '@radix-ui/react-icons';
import { ImageWithAspectBadge } from './common/ImageWithAspectBadge';

interface PreviewPaneProps {
    job: JobType;
    step: Step | null;
}

export function PreviewPane({ job, step }: PreviewPaneProps) {
    const [viewMode, setViewMode] = useState<'input' | 'output'>('output');
    const [refreshKey, setRefreshKey] = useState(0);
    const [showMask, setShowMask] = useState(false);

    useEffect(() => {
        if (viewMode !== 'input') {
            setShowMask(false);
        }
    }, [viewMode, step?.id]);

    const getImageUrl = () => {
        let url = null;
        if (!step) {
            // Show source image
            if (job.source_image) {
                url = api.getAssetUrl(job.id, job.source_image);
            }
        } else if (viewMode === 'output' && step.output_asset_id) {
            url = api.getAssetUrl(job.id, step.output_asset_id);
        } else if (viewMode === 'input') {
            const inputId = step.input_asset_id || job.source_image;
            if (inputId) {
                url = api.getAssetUrl(job.id, inputId);
            }
        } else if (job.source_image) {
            url = api.getAssetUrl(job.id, job.source_image);
        }

        if (url) {
            // Force refresh by adding extra key
            return `${url}&rk=${refreshKey}`;
        }
        return null;
    };

    const imageUrl = getImageUrl();
    const maskUrl = step?.mask_asset_id ? api.getAssetUrl(job.id, step.mask_asset_id) : null;

    const handleDownload = async () => {
        if (!imageUrl) return;

        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;

            // Determine filename
            let filename = `scenehf_${job.id.slice(0, 8)}`;
            if (step) {
                filename += `_${step.name.replace(/\s+/g, '_').toLowerCase()}`;
                if (viewMode === 'input') filename += '_input';
            } else {
                filename += '_source';
            }
            filename += '.png';

            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download image. Is the server running?');
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Controls */}
            {step && (
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setViewMode('input')}
                            className={`px-3 py-1 rounded text-sm ${viewMode === 'input'
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:bg-[var(--border)]'
                                }`}
                        >
                            Input
                        </button>
                        <button
                            onClick={() => setViewMode('output')}
                            className={`px-3 py-1 rounded text-sm ${viewMode === 'output'
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:bg-[var(--border)]'
                                }`}
                        >
                            Output
                        </button>
                        <button
                            onClick={() => setRefreshKey(prev => prev + 1)}
                            className="p-2 bg-[var(--panel-contrast)] text-[var(--text-subtle)] rounded hover:bg-[var(--border)] transition-colors"
                            title="Refresh Image"
                        >
                            <UpdateIcon className={step.status === 'RUNNING' ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={!imageUrl}
                            className="p-2 bg-[var(--panel-contrast)] text-[var(--text-subtle)] rounded hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Download Image"
                        >
                            <DownloadIcon />
                        </button>
                        {step?.mask_asset_id && viewMode === 'input' && (
                            <button
                                onClick={() => setShowMask((prev) => !prev)}
                                className={`px-3 py-1 rounded text-sm ${showMask
                                    ? 'bg-[var(--accent)] text-white'
                                    : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:bg-[var(--border)]'
                                    }`}
                                title="Toggle mask overlay"
                            >
                                Mask
                            </button>
                        )}
                    </div>

                    {step.validation && (
                        <div className="text-xs text-[var(--text-subtle)]">
                            Metrics: {Object.entries(step.validation.metrics)
                                .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
                                .join(', ')}
                        </div>
                    )}
                </div>
            )}

            {/* Image */}
            <div className="flex-1 glass-card rounded-lg overflow-hidden flex items-center justify-center relative group">
                {imageUrl ? (
                    <>
                        <ImageWithAspectBadge
                            src={imageUrl}
                            alt="Preview"
                            className={`max-w-full max-h-full object-contain transition-all duration-300 ${step?.status === 'RUNNING' ? 'opacity-30 blur-sm scale-95' : 'opacity-100'}`}
                            wrapperClassName="max-w-full max-h-full"
                        />
                        {showMask && maskUrl && viewMode === 'input' && (
                            <img
                                src={maskUrl}
                                alt="Mask overlay"
                                className="absolute inset-0 max-w-full max-h-full object-contain opacity-35 mix-blend-multiply pointer-events-none"
                            />
                        )}

                        {step && step.status === 'RUNNING' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-[2px]">
                                <div className="w-10 h-10 border-4 border-[var(--accent-soft)] border-t-[var(--accent)] rounded-full animate-spin" />
                                <div className="text-sm font-semibold text-[var(--text)] tracking-widest uppercase animate-pulse">
                                    Generating...
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-[var(--text-subtle)]">No image available</div>
                )}

                {step && (
                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur p-2 rounded border border-[var(--border)] opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Status</div>
                        <div className={`text-xs font-bold ${step.status === 'SUCCESS' ? 'text-[var(--success)]' : step.status === 'FAILED' ? 'text-[var(--danger)]' : 'text-[var(--accent-strong)]'}`}>
                            {step.status}
                        </div>
                    </div>
                )}
            </div>

            {/* Info */}
            {step && (
                <div className="mt-4 text-xs text-[var(--text-subtle)] space-y-1">
                    <div><strong>Prompt:</strong> {step.custom_prompt || step.prompt}</div>
                    {step.validation && (
                        <div><strong>Validation:</strong> {step.validation.notes}</div>
                    )}
                </div>
            )}
        </div>
    );
}
