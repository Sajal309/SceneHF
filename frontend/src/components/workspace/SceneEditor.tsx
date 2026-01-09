import { useState, useEffect } from 'react';
import { Job as JobType, Step, api } from '../../lib/api';
import { PlayIcon, ReloadIcon, UpdateIcon, Cross2Icon, PlusIcon } from '@radix-ui/react-icons';

interface SceneEditorProps {
    job: JobType;
    selectedStep: Step | null;
    onRunPlan: () => void;
    onRerunStep: (stepId: string, prompt: string) => void;
    onClearScene: () => void;
    onNewScene: () => void;
}

export function SceneEditor({ job, selectedStep, onRunPlan, onRerunStep, onClearScene, onNewScene }: SceneEditorProps) {
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
                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold shadow-lg transition-all"
                >
                    <PlusIcon className="w-4 h-4" />
                    New Scene
                </button>
            </div>

            <div className="flex-1 flex flex-col p-6 bg-gray-950 overflow-y-auto custom-scrollbar min-h-0">
                {/* Scene Image */}
                <div className="flex-1 bg-gray-900 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center mb-6 relative group">
                    {imageUrl ? (
                        <>
                            <img
                                src={imageUrl}
                                alt="Scene"
                                className="max-w-full max-h-full object-contain"
                            />

                            {/* Clear Scene Button */}
                            <button
                                onClick={onClearScene}
                                className="absolute top-4 right-4 p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                title="Clear Scene"
                            >
                                <Cross2Icon className="w-5 h-5 text-red-400" />
                            </button>

                            {selectedStep && (
                                <div className="absolute top-4 left-4 bg-black/80 backdrop-blur px-3 py-1.5 rounded-lg border border-gray-700">
                                    <div className="text-xs text-gray-400">Viewing</div>
                                    <div className="text-sm font-semibold text-white">{selectedStep.name}</div>
                                </div>
                            )}
                            {selectedStep && (selectedStep.status === 'RUNNING' || selectedStep.status === 'QUEUED') && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
                                    <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                                    <div className="text-sm font-bold text-white tracking-widest uppercase">
                                        {selectedStep.status === 'RUNNING' ? 'Generating...' : 'Queued...'}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-gray-600 text-center">
                            <div className="text-4xl mb-2">📷</div>
                            <div>No image available</div>
                        </div>
                    )}
                </div>

                {/* Prompt Editor */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-gray-300">
                            {selectedStep ? `Prompt for ${selectedStep.name}` : 'Scene Description'}
                        </label>
                        {selectedStep && (
                            <span className="text-xs text-gray-500">
                                Step {selectedStep.index + 1}: {selectedStep.type}
                            </span>
                        )}
                    </div>

                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={selectedStep ? "Edit the prompt and click Rerun..." : "Describe the scene to generate a plan..."}
                        className="w-full h-24 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                    />

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        {selectedStep ? (
                            <button
                                onClick={() => onRerunStep(selectedStep.id, prompt)}
                                disabled={!prompt.trim()}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg font-semibold transition-all disabled:cursor-not-allowed"
                            >
                                <ReloadIcon />
                                Rerun Step
                            </button>
                        ) : (
                            <button
                                onClick={onRunPlan}
                                disabled={job.status !== 'PLANNED'}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg font-semibold transition-all disabled:cursor-not-allowed"
                            >
                                <PlayIcon />
                                Run All Steps
                            </button>
                        )}

                        {selectedStep && selectedStep.output_asset_id && (
                            <button
                                onClick={async () => {
                                    try {
                                        await api.bgRemoveStep(job.id, selectedStep.id);
                                    } catch (error) {
                                        console.error('BG remove failed:', error);
                                    }
                                }}
                                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-all flex items-center gap-2"
                            >
                                <UpdateIcon />
                                Remove BG
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
