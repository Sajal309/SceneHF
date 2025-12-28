import { useState } from 'react';
import { Job as JobType, Step, api } from '../lib/api';

interface PreviewPaneProps {
    job: JobType;
    step: Step | null;
}

export function PreviewPane({ job, step }: PreviewPaneProps) {
    const [viewMode, setViewMode] = useState<'input' | 'output'>('output');

    const getImageUrl = () => {
        if (!step) {
            // Show source image
            if (job.source_image) {
                return api.getAssetUrl(job.id, job.source_image);
            }
            return null;
        }

        if (viewMode === 'output' && step.output_asset_id) {
            return api.getAssetUrl(job.id, step.output_asset_id);
        }

        if (viewMode === 'input') {
            const inputId = step.input_asset_id || job.source_image;
            if (inputId) {
                return api.getAssetUrl(job.id, inputId);
            }
        }

        // Fallback to source
        if (job.source_image) {
            return api.getAssetUrl(job.id, job.source_image);
        }

        return null;
    };

    const imageUrl = getImageUrl();

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
            <div className="flex-1 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt="Preview"
                        className="max-w-full max-h-full object-contain"
                    />
                ) : (
                    <div className="text-slate-500">No image available</div>
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
