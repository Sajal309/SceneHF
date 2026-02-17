import { AssetKind, Job as JobType, Step, StepStatus, StepType, api } from '../../lib/api';
import { ReloadIcon, DownloadIcon, MagicWandIcon, UpdateIcon, TransparencyGridIcon, MaskOnIcon, MaskOffIcon, PlayIcon, StopIcon } from '@radix-ui/react-icons';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { useState, type DragEvent } from 'react';
import { ImageWithAspectBadge } from '../common/ImageWithAspectBadge';

interface StepListProps {
    job: JobType;
    selectedStep: Step | null;
    onSelectStep: (step: Step) => void;
    onRerunStep: (stepId: string, customPrompt?: string) => void;
    onStopStep: (stepId: string) => void;
    onOpenMask: (stepId: string) => void;
    onBgRemove: (stepId: string) => Promise<void> | void;
}

export function StepList({ job, selectedStep, onSelectStep, onRerunStep, onStopStep, onOpenMask, onBgRemove }: StepListProps) {
    const { settings } = useSettings();
    const [generatingVariations, setGeneratingVariations] = useState<string | null>(null); // stepId
    const [variationsMap, setVariationsMap] = useState<Record<string, string[]>>({}); // stepId -> variations
    const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);
    const [uploadingStepId, setUploadingStepId] = useState<string | null>(null);
    const [bgRemovingStepId, setBgRemovingStepId] = useState<string | null>(null);
    const iconBtnBase = 'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const iconBtnPrimary = `${iconBtnBase} border-blue-200 bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-blue-100`;
    const iconBtnNeutral = `${iconBtnBase} border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:bg-[var(--border)] hover:text-[var(--text)]`;
    const iconBtnSuccess = `${iconBtnBase} border-green-200 bg-green-50 text-[var(--success)] hover:bg-green-100`;
    const iconBtnDanger = `${iconBtnBase} border-red-200 bg-red-50 text-[var(--danger)] hover:bg-red-100`;

    const getStatusColor = (status: StepStatus) => {
        switch (status) {
            case StepStatus.SUCCESS:
                return 'bg-green-100 text-[var(--success)] border-green-200';
            case StepStatus.RUNNING:
                return 'bg-blue-100 text-[var(--accent-strong)] border-blue-200';
            case StepStatus.QUEUED:
                return 'bg-amber-50 text-amber-700 border-amber-200';
            case StepStatus.FAILED:
                return 'bg-red-100 text-[var(--danger)] border-red-200';
            case StepStatus.CANCELLED:
                return 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)]';
            default:
                return 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)]';
        }
    };

    const getBgRemovedAssetId = (step: Step): string | null => {
        const candidates = [...(step.outputs_history || [])];
        if (step.output_asset_id && candidates[candidates.length - 1] !== step.output_asset_id) {
            candidates.push(step.output_asset_id);
        }
        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const asset = job.assets?.[candidates[i]];
            if (asset?.kind === AssetKind.BG_REMOVED) return asset.id;
        }
        return null;
    };

    const getOriginalOutputAssetId = (step: Step): string | null => {
        const candidates = [...(step.outputs_history || [])];
        if (step.output_asset_id && candidates[candidates.length - 1] !== step.output_asset_id) {
            candidates.push(step.output_asset_id);
        }
        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const asset = job.assets?.[candidates[i]];
            if (asset && asset.kind !== AssetKind.BG_REMOVED) return asset.id;
        }
        return step.output_asset_id || null;
    };

    const handleDownload = async (step: Step) => {
        const originalAssetId = getOriginalOutputAssetId(step);
        if (!originalAssetId) return;

        try {
            const url = api.getAssetUrl(job.id, originalAssetId);
            const response = await fetch(url);
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', `${step.name.replace(/\s+/g, '_').toLowerCase()}.png`);
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Download failed:', error);
        }
    };

    const handleDownloadAll = () => {
        const url = api.getExportUrl(job.id);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `job_${job.id}_export.zip`);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
    };

    const handleGenerateVariations = async (step: Step) => {
        setGeneratingVariations(step.id);
        try {
            const headers = getApiHeaders(settings);
            const modelConfig: Record<string, any> = { model: settings.model };
            Object.entries(settings.llmParams).forEach(([key, param]) => {
                if (param.enabled) modelConfig[key] = param.value;
            });

            const { variations } = await api.getPromptVariations(
                job.id,
                step.id,
                settings.provider,
                modelConfig,
                headers
            );
            setVariationsMap(prev => ({ ...prev, [step.id]: variations }));
        } catch (error) {
            console.error('Failed to get variations:', error);
        } finally {
            setGeneratingVariations(null);
        }
    };

    const handleDropOnStep = async (e: DragEvent<HTMLDivElement>, step: Step) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverStepId(null);

        setUploadingStepId(step.id);
        try {
            const raw = e.dataTransfer.getData('application/x-scenehf-asset');
            if (raw) {
                try {
                    const { jobId, assetId, filename } = JSON.parse(raw) as { jobId: string; assetId: string; filename?: string };
                    const assetUrl = api.getAssetUrl(jobId, assetId);
                    const response = await fetch(assetUrl);
                    if (!response.ok) throw new Error('Failed to load dragged image');
                    const blob = await response.blob();
                    const extension = blob.type.split('/')[1] || 'png';
                    const name = filename || `${assetId}.${extension}`;
                    const draggedFile = new File([blob], name, { type: blob.type || 'image/png' });
                    await api.replaceStepImage(job.id, step.id, draggedFile, 'output');
                    return;
                } catch (err) {
                    console.error('Failed to load dragged asset:', err);
                }
            }

            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                console.error('Only image files can be dropped');
                return;
            }
            await api.replaceStepImage(job.id, step.id, file, 'output');
        } catch (error) {
            console.error('Failed to replace step image:', error);
        } finally {
            setUploadingStepId(null);
        }
    };

    const handleBgRemove = async (stepId: string) => {
        setBgRemovingStepId(stepId);
        try {
            await onBgRemove(stepId);
        } finally {
            setBgRemovingStepId(null);
        }
    };

    return (
        <div className="w-96 glass-panel border-l border-[var(--border)] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-[var(--text)]">Generation Steps</h2>
                    <p className="text-xs text-[var(--text-subtle)] mt-1">
                        {job.steps.length} steps • Click to edit
                    </p>
                </div>
                {job.steps.length > 0 && (
                    <button
                        onClick={handleDownloadAll}
                        className="inline-flex h-8 w-8 items-center justify-center bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-white rounded-lg transition-all shadow-sm active:scale-95"
                        title="Download all images as ZIP"
                        aria-label="Download all images as ZIP"
                    >
                        <DownloadIcon className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Step List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 pb-6 space-y-2 bg-transparent">
                {job.steps.length === 0 ? (
                    <div className="text-center py-12 text-[var(--text-subtle)] text-sm">
                        No steps yet. Generate a plan first.
                    </div>
                ) : (
                    job.steps.map((step) => {
                        const isSelected = selectedStep?.id === step.id;
                        const bgRemovedAssetId = getBgRemovedAssetId(step);
                        const imageUrl = step.output_asset_id
                            ? api.getAssetUrl(job.id, step.output_asset_id)
                            : step.input_asset_id
                                ? api.getAssetUrl(job.id, step.input_asset_id)
                                : null;
                        const variations = variationsMap[step.id] ?? step.prompt_variations ?? [];
                        const isDragOver = dragOverStepId === step.id;
                        const isUploading = uploadingStepId === step.id;
                        const requiresMask = step.mask_mode === 'MANUAL' && !step.mask_asset_id;
                        const canMask = step.type === StepType.EXTRACT || step.type === StepType.REMOVE || step.type === StepType.EDIT;
                        const hasManualMask = step.mask_mode === 'MANUAL' && !!step.mask_asset_id;
                        const statusLabel = step.status === StepStatus.QUEUED ? 'PAUSED' : step.status;

                        return (
                            <div
                                key={step.id}
                                onClick={() => onSelectStep(step)}
                                onDragEnter={(e) => {
                                    e.preventDefault();
                                    setDragOverStepId(step.id);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    setDragOverStepId(step.id);
                                }}
                                onDragLeave={(e) => {
                                    e.preventDefault();
                                    setDragOverStepId(prev => (prev === step.id ? null : prev));
                                }}
                                onDrop={(e) => handleDropOnStep(e, step)}
                                className={`rounded-xl border overflow-hidden cursor-pointer transition-all ${isSelected
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-card)]'
                                    : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-muted)]'
                                    }`}
                            >
                                {/* Thumbnail */}
                                <div className="aspect-video w-full bg-[var(--panel-contrast)] overflow-hidden relative">
                                    {imageUrl ? (
                                        <>
                                            <ImageWithAspectBadge
                                                src={imageUrl}
                                                alt={step.name}
                                                className="w-full h-full object-contain"
                                                wrapperClassName="w-full h-full"
                                                draggable
                                                onDragStart={(e) => {
                                                    if (!step.output_asset_id && !step.input_asset_id) return;
                                                    const assetId = step.output_asset_id || step.input_asset_id;
                                                    if (!assetId) return;
                                                    e.dataTransfer.setData(
                                                        'application/x-scenehf-asset',
                                                        JSON.stringify({
                                                            jobId: job.id,
                                                            assetId,
                                                            filename: `${step.name.replace(/\s+/g, '_').toLowerCase()}.png`
                                                        })
                                                    );
                                                    e.dataTransfer.effectAllowed = 'copy';
                                                }}
                                            />
                                            {step.mask_asset_id && (
                                                <img
                                                    src={api.getAssetUrl(job.id, step.mask_asset_id)}
                                                    alt="Mask overlay"
                                                    className="absolute inset-0 w-full h-full object-contain opacity-35 mix-blend-multiply pointer-events-none"
                                                />
                                            )}
                                        </>
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[var(--text-subtle)] text-xs">
                                            No Preview
                                        </div>
                                    )}
                                    {(step.status === 'RUNNING') && (
                                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                                            <div className="w-8 h-8 border-4 border-[var(--accent-soft)] border-t-[var(--accent)] rounded-full animate-spin" />
                                        </div>
                                    )}
                                    {(isDragOver || isUploading) && (
                                        <div className="absolute inset-0 bg-[var(--accent-soft)]/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-[var(--accent)]">
                                            <span className="text-xs font-semibold text-[var(--accent-strong)]">
                                                {isUploading ? 'Uploading...' : 'Drop to replace image'}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigator.clipboard.writeText(step.id);
                                                    }}
                                                    className="text-[10px] font-mono text-[var(--accent-strong)] hover:text-[var(--accent)] underline decoration-dotted"
                                                    title="Copy job ID"
                                                >
                                                    {step.id}
                                                </button>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(step.status)}`}>
                                                    {statusLabel}
                                                </span>
                                                {canMask && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // Mask can be cleared inside the popup; keep toggle as an "open/edit mask" action
                                                            onOpenMask(step.id);
                                                        }}
                                                        className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${hasManualMask
                                                            ? 'border-green-300 bg-green-50 text-green-700'
                                                            : 'border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:border-[var(--border-strong)]'
                                                            }`}
                                                        title={hasManualMask ? 'Mask applied (click to edit/replace)' : 'Add mask'}
                                                        aria-label={hasManualMask ? 'Mask applied' : 'Add mask'}
                                                    >
                                                        {hasManualMask ? <MaskOnIcon className="h-3 w-3" /> : <MaskOffIcon className="h-3 w-3" />}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-sm font-medium text-[var(--text)] truncate">
                                                {step.name}
                                            </div>
                                            <div className="text-xs text-[var(--text-subtle)] mt-1 line-clamp-2">
                                                {step.custom_prompt || step.prompt}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--border)] flex-wrap">
                                        {step.status === 'RUNNING' ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onStopStep(step.id);
                                                }}
                                                className={iconBtnDanger}
                                                title="Stop running step"
                                                aria-label="Stop running step"
                                            >
                                                <StopIcon className="w-3.5 h-3.5" />
                                            </button>
                                        ) : step.status === 'QUEUED' ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!requiresMask) onRerunStep(step.id);
                                                }}
                                                disabled={requiresMask}
                                                className={requiresMask ? iconBtnNeutral : iconBtnPrimary}
                                                title={requiresMask ? 'Attach a mask before running' : 'Start this step'}
                                                aria-label={requiresMask ? 'Attach mask before running' : 'Start step'}
                                            >
                                                <PlayIcon className="w-3.5 h-3.5" />
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (!requiresMask) onRerunStep(step.id);
                                                    }}
                                                    disabled={requiresMask}
                                                    className={requiresMask ? iconBtnNeutral : iconBtnPrimary}
                                                    title={requiresMask ? 'Attach a mask before running' : 'Rerun step'}
                                                    aria-label={requiresMask ? 'Attach mask before rerun' : 'Rerun step'}
                                                >
                                                    <ReloadIcon className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleGenerateVariations(step);
                                                    }}
                                                    disabled={generatingVariations === step.id}
                                                    className={iconBtnNeutral}
                                                    title={generatingVariations === step.id ? 'Generating prompt variations...' : 'Generate prompt variations'}
                                                    aria-label={generatingVariations === step.id ? 'Generating prompt variations' : 'Generate prompt variations'}
                                                >
                                                    {generatingVariations === step.id ? (
                                                        <UpdateIcon className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <MagicWandIcon className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                                {step.output_asset_id && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownload(step);
                                                        }}
                                                        className={iconBtnSuccess}
                                                        title="Download step output"
                                                        aria-label="Download step output"
                                                    >
                                                        <DownloadIcon className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {step.output_asset_id && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleBgRemove(step.id);
                                                        }}
                                                        disabled={bgRemovingStepId === step.id}
                                                        className={iconBtnNeutral}
                                                        title={bgRemovingStepId === step.id ? 'Removing background...' : 'Remove background'}
                                                        aria-label={bgRemovingStepId === step.id ? 'Removing background' : 'Remove background'}
                                                    >
                                                        {bgRemovingStepId === step.id ? (
                                                            <UpdateIcon className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <TransparencyGridIcon className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {/* Variations List */}
                                    {variations.length > 0 && (
                                        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-[var(--text-subtle)] uppercase tracking-wider">AI Variations</span>
                                                {variationsMap[step.id] && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setVariationsMap(prev => {
                                                                const next = { ...prev };
                                                                delete next[step.id];
                                                                return next;
                                                            });
                                                        }}
                                                        className="text-[10px] text-[var(--text-subtle)] hover:text-[var(--text)]"
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </div>
                                            <div className="grid gap-2">
                                                {variations.map((v, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onRerunStep(step.id, v);
                                                        }}
                                                        className="text-left text-[11px] p-2 bg-[var(--panel-muted)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md text-[var(--text-subtle)] hover:text-[var(--accent-strong)] transition-all line-clamp-2"
                                                        title={v}
                                                    >
                                                        {v}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {step.validation && (
                                        <div className="text-[10px] text-[var(--text-subtle)] pt-1">
                                            {step.validation.notes}
                                        </div>
                                    )}

                                    {requiresMask && (
                                        <div className="text-[10px] text-[var(--warning)]">
                                            Manual mask selected. Upload or draw a mask to run.
                                        </div>
                                    )}

                                    {bgRemovedAssetId && (
                                        <div className="pt-2 border-t border-[var(--border)] space-y-2">
                                            <div className="text-[10px] text-[var(--text-subtle)]">BG Removed</div>
                                            <ImageWithAspectBadge
                                                src={api.getAssetUrl(job.id, bgRemovedAssetId)}
                                                alt="Background removed"
                                                className="w-full h-20 object-contain rounded-md border border-[var(--border)]"
                                                wrapperClassName="w-full"
                                            />
                                            <a
                                                href={api.getAssetUrl(job.id, bgRemovedAssetId)}
                                                download={`${step.name.replace(/\s+/g, '_').toLowerCase()}_bg_removed.png`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex h-7 w-7 items-center justify-center text-xs bg-[var(--panel-contrast)] hover:bg-[var(--border)] text-[var(--text)] rounded border border-[var(--border)]"
                                                title="Download background removed image"
                                                aria-label="Download background removed image"
                                            >
                                                <DownloadIcon className="w-3 h-3" />
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
