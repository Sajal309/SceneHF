import { useState } from 'react';
import { Job as JobType, Step, api } from '../lib/api';
import { UpdateIcon, DownloadIcon } from '@radix-ui/react-icons';

interface PreviewPaneProps {
    job: JobType;
    step: Step | null;
}

export function PreviewPane({ job, step }: PreviewPaneProps) {
    const [viewMode, setViewMode] = useState<'input' | 'output'>('output');
    const [refreshKey, setRefreshKey] = useState(0);

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
                                ? 'bg-primary-600 text-white'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                        >
                            Input
                        </button>
                        <button
                            onClick={() => setViewMode('output')}
                            className={`px-3 py-1 rounded text-sm ${viewMode === 'output'
                                ? 'bg-primary-600 text-white'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                        >
                            Output
                        </button>
                        <button
                            onClick={() => setRefreshKey(prev => prev + 1)}
                            className="p-2 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                            title="Refresh Image"
                        >
                            <UpdateIcon className={step.status === 'RUNNING' ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={!imageUrl}
                            className="p-2 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Download Image"
                        >
                            <DownloadIcon />
                        </button>
                    </div>

                    {step.validation && (
                        <div className="text-xs text-slate-400">
                            Metrics: {Object.entries(step.validation.metrics)
                                .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
                                .join(', ')}
                        </div>
                    )}
                </div>
            )}

            {/* Image */}
            <div className="flex-1 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center relative group">
                {imageUrl ? (
                    <>
                        <img
                            src={imageUrl}
                            alt="Preview"
                            className={`max-w-full max-h-full object-contain transition-all duration-300 ${step?.status === 'RUNNING' ? 'opacity-30 blur-sm scale-95' : 'opacity-100'}`}
                        />

                        {step && (step.status === 'RUNNING' || step.status === 'QUEUED') && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/20 backdrop-blur-[2px]">
                                <div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                                <div className="text-sm font-bold text-white tracking-widest uppercase animate-pulse">
                                    {step.status === 'RUNNING' ? 'Generating...' : 'Queued...'}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-slate-500">No image available</div>
                )}

                {step && (
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur p-2 rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Status</div>
                        <div className={`text-xs font-bold ${step.status === 'SUCCESS' ? 'text-green-400' : step.status === 'FAILED' ? 'text-red-400' : 'text-blue-400'}`}>
                            {step.status}
                        </div>
                    </div>
                )}
            </div>

            {/* Info */}
            {step && (
                <div className="mt-4 text-xs text-slate-400 space-y-1">
                    <div><strong>Prompt:</strong> {step.custom_prompt || step.prompt}</div>
                    {step.validation && (
                        <div><strong>Validation:</strong> {step.validation.notes}</div>
                    )}
                </div>
            )}
        </div>
    );
}
