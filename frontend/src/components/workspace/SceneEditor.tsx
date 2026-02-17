import { useState, useEffect } from 'react';
import { Job as JobType, Step, api, StepHistoryEntry, Asset } from '../../lib/api';
import { PlayIcon, ReloadIcon, UpdateIcon, Cross2Icon, PlusIcon } from '@radix-ui/react-icons';
import { ImageWithAspectBadge } from '../common/ImageWithAspectBadge';

interface SceneEditorProps {
    job: JobType;
    selectedStep: Step | null;
    onRunPlan: () => void;
    onRerunStep: (stepId: string, prompt: string) => void;
    onBgRemove: (stepId: string) => void;
    onClearScene: () => void;
    onNewScene: () => void;
}

export function SceneEditor({ job, selectedStep, onRunPlan, onRerunStep, onBgRemove, onClearScene, onNewScene }: SceneEditorProps) {
    const [prompt, setPrompt] = useState('');
    const [history, setHistory] = useState<StepHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

    // Pre-load prompt when step changes
    useEffect(() => {
        if (selectedStep) {
            setPrompt(selectedStep.custom_prompt || selectedStep.prompt);
        } else {
            setPrompt('');
        }
        setPreviewAssetId(null);
    }, [selectedStep]);

    useEffect(() => {
        const fetchHistory = async () => {
            if (!selectedStep) {
                setHistory([]);
                return;
            }
            setHistoryLoading(true);
            try {
                const res = await api.getStepHistory(job.id, selectedStep.id);
                setHistory(res.history || []);
            } catch (error) {
                console.error('Failed to load history', error);
            } finally {
                setHistoryLoading(false);
            }
        };
        fetchHistory();
    }, [job.id, selectedStep?.id, selectedStep?.last_run_id]);

    const findAssetForRun = (entry: StepHistoryEntry): Asset | undefined => {
        if (entry.output_asset_id && job.assets?.[entry.output_asset_id]) {
            return job.assets[entry.output_asset_id];
        }
        if (entry.run_id) {
            const match = Object.values(job.assets || {}).find(
                (asset) => asset.run_id === entry.run_id && asset.step_id === selectedStep?.id
            );
            if (match) return match;
        }
        if (selectedStep?.outputs_history?.length) {
            const fallback = selectedStep.outputs_history
                .map(id => job.assets[id])
                .find(a => a && a.run_id === entry.run_id);
            if (fallback) return fallback;
        }
        return undefined;
    };

    const formatTimestamp = (ts?: string) => {
        if (!ts) return '—';
        // Expect YYYYMMDD_HHMMSS_mmm
        const parts = ts.split('_');
        if (parts.length >= 2) {
            const [date, time, msPart] = parts;
            const year = parseInt(date.slice(0, 4), 10);
            const month = parseInt(date.slice(4, 6), 10) - 1;
            const day = parseInt(date.slice(6, 8), 10);
            const hour = parseInt(time.slice(0, 2), 10);
            const minute = parseInt(time.slice(2, 4), 10);
            const second = parseInt(time.slice(4, 6), 10);
            const ms = msPart ? parseInt(msPart, 10) : 0;
            const dt = new Date(year, month, day, hour, minute, second, ms);
            if (!isNaN(dt.getTime())) {
                return dt.toLocaleString([], { hour: '2-digit', minute: '2-digit' });
            }
        }
        const dt = new Date(ts);
        if (!isNaN(dt.getTime())) return dt.toLocaleString([], { hour: '2-digit', minute: '2-digit' });
        return '—';
    };

    // Determine what image to show
    const getDisplayImage = () => {
        if (previewAssetId) {
            return api.getAssetUrl(job.id, previewAssetId);
        }
        if (selectedStep) {
            // Show step output if available, otherwise input
            if (selectedStep.output_asset_id) {
                return api.getAssetUrl(job.id, selectedStep.output_asset_id);
            } else if (selectedStep.input_asset_id) {
                return api.getAssetUrl(job.id, selectedStep.input_asset_id);
            }
        }
        // Fallback to source image
        if (job.source_image) {
            return api.getAssetUrl(job.id, job.source_image);
        }
        return null;
    };

    const handleSetActive = async (assetId: string) => {
        if (!selectedStep) return;
        try {
            await api.setActiveOutput(job.id, selectedStep.id, assetId);
            setPreviewAssetId(null);
        } catch (error) {
            console.error('Failed to set active output', error);
        }
    };

    const handleOpenInFinder = async () => {
        try {
            await api.openInFinder(job.id);
        } catch (error) {
            console.error('Failed to open in Finder', error);
            alert('Unable to open Finder. Please open the storage folder manually.');
        }
    };

    const imageUrl = getDisplayImage();
    const agentic = job.plan?.agentic_analysis;

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className="absolute top-4 left-6 z-10 flex gap-2">
                <button
                    onClick={onNewScene}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[var(--panel)] hover:bg-[var(--panel-contrast)] text-[var(--text)] rounded-lg text-sm font-semibold shadow-sm border border-[var(--border)] transition-all"
                >
                    <PlusIcon className="w-4 h-4" />
                    New Scene
                </button>
                <button
                    onClick={handleOpenInFinder}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[var(--panel-contrast)] hover:bg-[var(--border)] text-[var(--text)] rounded-lg text-sm font-semibold shadow-sm border border-[var(--border)] transition-all"
                >
                    📂 Open in Finder
                </button>
            </div>

            <div className="flex-1 flex flex-col justify-center p-6 bg-[var(--bg)] overflow-y-auto custom-scrollbar min-h-0">
                <div className="glass-card rounded-2xl p-4 space-y-4">
                    {/* Scene Image */}
                    <div className="w-full h-[420px] lg:h-[520px] rounded-xl overflow-hidden flex items-center justify-center relative group border border-[var(--border)] bg-[var(--panel-contrast)]">
                        {imageUrl ? (
                            <>
                                <ImageWithAspectBadge
                                    src={imageUrl}
                                    alt="Scene"
                                    className="w-full h-full object-cover"
                                    wrapperClassName="w-full h-full"
                                    draggable
                                    onDragStart={(e) => {
                                        const assetId = previewAssetId
                                            || selectedStep?.output_asset_id
                                            || selectedStep?.input_asset_id
                                            || job.source_image;
                                        if (!assetId) return;
                                        e.dataTransfer.setData(
                                            'application/x-scenehf-asset',
                                            JSON.stringify({
                                                jobId: job.id,
                                                assetId,
                                                filename: `scene_${job.id.slice(0, 8)}.png`
                                            })
                                        );
                                        e.dataTransfer.effectAllowed = 'copy';
                                    }}
                                />

                                {/* Clear Scene Button */}
                                <button
                                    onClick={onClearScene}
                                    className="absolute top-4 right-4 p-2 bg-white/80 hover:bg-red-50 border border-red-200 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    title="Clear Scene"
                                >
                                    <Cross2Icon className="w-5 h-5 text-[var(--danger)]" />
                                </button>

                                {selectedStep && (
                                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg border border-[var(--border)] shadow-sm">
                                        <div className="text-xs text-[var(--text-subtle)]">Viewing</div>
                                        <div className="text-sm font-semibold text-[var(--text)]">{selectedStep.name}</div>
                                    </div>
                                )}
                                {selectedStep && selectedStep.status === 'RUNNING' && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm">
                                        <div className="w-12 h-12 border-4 border-[var(--accent-soft)] border-t-[var(--accent)] rounded-full animate-spin" />
                                        <div className="text-sm font-semibold text-[var(--text)] tracking-widest uppercase">
                                            Generating...
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-[var(--text-subtle)] text-center">
                                <div className="text-4xl mb-2">📷</div>
                                <div>No image available</div>
                            </div>
                        )}
                    </div>

                    {/* Prompt Editor */}
                    <div className="space-y-3">
                        {!selectedStep && agentic && (
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold text-[var(--text)]">Agent Plan Assessment</div>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text-subtle)]">
                                        {agentic.mode || 'AUTO'} • {agentic.scene_complexity || '—'}
                                    </span>
                                </div>
                                <div className="text-xs text-[var(--text-subtle)]">
                                    Estimated layers: <span className="text-[var(--text)] font-medium">{agentic.estimated_layer_count ?? job.steps.length}</span>
                                    {' '}• Risk: <span className="text-[var(--text)] font-medium">{agentic.risk_level || '—'}</span>
                                </div>
                                {agentic.decision_rationale && (
                                    <div className="text-xs text-[var(--text-subtle)]">{agentic.decision_rationale}</div>
                                )}
                                {!!agentic.potential_challenges?.length && (
                                    <div className="text-xs text-[var(--text-subtle)]">
                                        Challenges: {agentic.potential_challenges.slice(0, 3).join(' • ')}
                                    </div>
                                )}
                                {!!agentic.recommended_next_actions?.length && (
                                    <div className="text-xs text-[var(--text-subtle)]">
                                        Next: {agentic.recommended_next_actions[0].action} — {agentic.recommended_next_actions[0].reason}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-[var(--text)]">
                                {selectedStep ? `Prompt for ${selectedStep.name}` : 'Scene Description'}
                            </label>
                            {selectedStep && (
                                <span className="text-xs text-[var(--text-subtle)]">
                                    Step {selectedStep.index + 1}: {selectedStep.type}
                                </span>
                            )}
                        </div>

                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={selectedStep ? "Edit the prompt and click Rerun..." : "Describe the scene to generate a plan..."}
                            className="w-full h-24 bg-[var(--panel)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--text-subtle)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none resize-none"
                        />

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            {selectedStep ? (
                                <>
                                <button
                                    onClick={() => onRerunStep(selectedStep.id, prompt)}
                                    disabled={((!prompt.trim() && selectedStep.mask_intent !== 'EXTRACT_HELPER') || (selectedStep.mask_mode === 'MANUAL' && !selectedStep.mask_asset_id))}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-lg font-semibold transition-all disabled:cursor-not-allowed"
                                >
                                    <ReloadIcon />
                                    Rerun Step
                                </button>
                                {selectedStep.mask_mode === 'MANUAL' && !selectedStep.mask_asset_id && (
                                    <div className="text-[11px] text-[var(--warning)] self-center">
                                        Mask required for manual mode.
                                    </div>
                                )}
                                {selectedStep.mask_intent === 'EXTRACT_HELPER' && !prompt.trim() && (
                                    <div className="text-[11px] text-[var(--text-subtle)] self-center">
                                        Prompt optional for Extract Helper.
                                    </div>
                                )}
                                </>
                            ) : (
                                <button
                                    onClick={onRunPlan}
                                    disabled={job.status !== 'IDLE'}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-lg font-semibold transition-all disabled:cursor-not-allowed"
                                >
                                    <PlayIcon />
                                    {job.status === 'PLANNED' ? 'Plan Ready' : 'Generate Plan'}
                                </button>
                            )}

                            {selectedStep && selectedStep.output_asset_id && (
                                <button
                                    onClick={() => onBgRemove(selectedStep.id)}
                                    className="px-4 py-2.5 bg-[var(--panel)] hover:bg-[var(--panel-contrast)] text-[var(--text)] rounded-lg font-semibold transition-all flex items-center gap-2 border border-[var(--border)]"
                                >
                                    <UpdateIcon />
                                    Remove BG
                                </button>
                            )}
                        </div>

                        {selectedStep && (
                            <div className="pt-4 border-t border-[var(--border)] space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold text-[var(--text)]">History</div>
                                    <div className="text-[11px] text-[var(--text-subtle)]">
                                        {historyLoading ? 'Loading…' : `${history.length} run${history.length === 1 ? '' : 's'}`}
                                    </div>
                                </div>
                                <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-1">
                                    {history.length === 0 && (
                                        <div className="text-[12px] text-[var(--text-subtle)]">
                                            No history yet. Run this step to start logging.
                                        </div>
                                    )}
                                    {history.map((entry) => {
                                        const asset = findAssetForRun(entry);
                                        const assetId = asset?.id;
                                        const status = entry.validation?.status || (entry.error ? 'FAILED' : 'UNKNOWN');
                                        const timestamp = entry.finished_at || entry.started_at;
                                        return (
                                            <div
                                                key={entry.run_id}
                                                className="min-w-[240px] border border-[var(--border)] rounded-lg bg-[var(--panel)] overflow-hidden shadow-sm"
                                                style={{ width: 240 }}
                                            >
                                                <div
                                                    className="aspect-video bg-[var(--panel-contrast)] cursor-pointer relative"
                                                    onClick={() => assetId && setPreviewAssetId(assetId)}
                                                >
                                                    {assetId ? (
                                                        <ImageWithAspectBadge
                                                            src={api.getAssetUrl(job.id, assetId)}
                                                            alt={entry.run_id}
                                                            className="w-full h-full object-contain"
                                                            wrapperClassName="w-full h-full"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-[var(--text-subtle)] text-xs">
                                                            No preview
                                                        </div>
                                                    )}
                                                    {assetId && selectedStep.output_asset_id === assetId && (
                                                        <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-[var(--success)] border border-green-200">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-2 space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-mono text-[var(--text-subtle)]">
                                                            {formatTimestamp(timestamp)}
                                                        </span>
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                                            status === 'SUCCESS'
                                                                ? 'bg-green-50 text-[var(--success)] border-green-200'
                                                                : status === 'FAILED'
                                                                    ? 'bg-red-50 text-[var(--danger)] border-red-200'
                                                                    : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)]'
                                                        }`}>
                                                            {status}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-[var(--text-subtle)] truncate">
                                                        Run {entry.run_id.slice(0, 8)}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => assetId && setPreviewAssetId(assetId)}
                                                            className="flex-1 text-[11px] px-2 py-1 bg-[var(--panel-contrast)] hover:bg-[var(--border)] rounded border border-[var(--border)] text-[var(--text)]"
                                                        >
                                                            Preview
                                                        </button>
                                                        <button
                                                            onClick={() => assetId && handleSetActive(assetId)}
                                                            disabled={!assetId}
                                                            className="flex-1 text-[11px] px-2 py-1 bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-white rounded border border-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            Set Active
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
