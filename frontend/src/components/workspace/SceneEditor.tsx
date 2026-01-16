import { useState, useEffect } from 'react';
import { Job as JobType, Step, api } from '../../lib/api';
import { PlayIcon, ReloadIcon, UpdateIcon, Cross2Icon, PlusIcon } from '@radix-ui/react-icons';

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

    // Pre-load prompt when step changes
    useEffect(() => {
        if (selectedStep) {
            setPrompt(selectedStep.custom_prompt || selectedStep.prompt);
        } else {
            setPrompt('');
        }
    }, [selectedStep]);

    // Determine what image to show
    const getDisplayImage = () => {
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

    const imageUrl = getDisplayImage();

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className="absolute top-4 left-6 z-10">
                <button
                    onClick={onNewScene}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[var(--panel)] hover:bg-[var(--panel-contrast)] text-[var(--text)] rounded-lg text-sm font-semibold shadow-sm border border-[var(--border)] transition-all"
                >
                    <PlusIcon className="w-4 h-4" />
                    New Scene
                </button>
            </div>

            <div className="flex-1 flex flex-col justify-center p-6 bg-[var(--bg)] overflow-y-auto custom-scrollbar min-h-0">
                <div className="glass-card rounded-2xl p-4 space-y-4">
                    {/* Scene Image */}
                    <div className="w-full h-[420px] lg:h-[520px] rounded-xl overflow-hidden flex items-center justify-center relative group border border-[var(--border)] bg-[var(--panel-contrast)]">
                        {imageUrl ? (
                            <>
                                <img
                                    src={imageUrl}
                                    alt="Scene"
                                    className="w-full h-full object-contain"
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
                                {selectedStep && (selectedStep.status === 'RUNNING' || selectedStep.status === 'QUEUED') && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm">
                                        <div className="w-12 h-12 border-4 border-[var(--accent-soft)] border-t-[var(--accent)] rounded-full animate-spin" />
                                        <div className="text-sm font-semibold text-[var(--text)] tracking-widest uppercase">
                                            {selectedStep.status === 'RUNNING' ? 'Generating...' : 'Queued...'}
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
                    </div>
                </div>
            </div>
        </div>
    );
}
