import { useCallback, useState, useEffect } from 'react';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { api, Job, JobStatus } from '../../lib/api';
import { UploadCard } from '../UploadCard';
import { SceneEditor } from './SceneEditor';
import { StepList } from './StepList';
import { MaskPopup } from './MaskPopup';
import { LogsPanel } from '../LogsPanel';
import { PauseIcon } from '@radix-ui/react-icons';
import { useJobSSE } from '../../lib/sse';

interface WorkspaceProps {
    jobId: string | null;
    onJobCreated: (jobId: string | null) => void;
    prefillImage?: File | null;
    onPrefillImageUsed?: () => void;
}

export function Workspace({ jobId, onJobCreated, prefillImage, onPrefillImageUsed }: WorkspaceProps) {
    const { settings } = useSettings();
    const [job, setJob] = useState<Job | null>(null);
    const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
    const [maskStepId, setMaskStepId] = useState<string | null>(null);
    const [logs, setLogs] = useState<any[]>([]);

    const mergeJobAssets = (prev: Job | null, updatedJob: Job): Job => {
        if (prev?.assets && updatedJob?.assets) {
            return {
                ...updatedJob,
                assets: { ...prev.assets, ...updatedJob.assets }
            };
        }
        return updatedJob;
    };

    // Persist job ID to localStorage
    useEffect(() => {
        if (jobId) {
            localStorage.setItem('scenehf_last_job', jobId);
        }
    }, [jobId]);

    // SSE for live updates
    const handleJobUpdate = useCallback((updatedJob: Job) => {
        setJob(prev => {
            // Always merge assets to prevent loss during concurrent updates
            if (prev?.assets && updatedJob?.assets) {
                const mergedAssets = { ...prev.assets, ...updatedJob.assets };
                console.log('[SSE] Merging assets:', {
                    prevCount: Object.keys(prev.assets).length,
                    newCount: Object.keys(updatedJob.assets).length,
                    mergedCount: Object.keys(mergedAssets).length
                });
                return {
                    ...updatedJob,
                    assets: mergedAssets
                };
            }
            // If no previous assets or new job has no assets, use what we have
            return updatedJob;
        });
    }, []);

    const handleStepUpdate = useCallback((updatedStep: any) => {
        setJob(prev => {
            if (!prev) return null;

            console.log('[SSE] Step update:', {
                stepId: updatedStep.id,
                assetCount: prev.assets ? Object.keys(prev.assets).length : 0
            });

            // Update the specific step while preserving everything else
            const updatedSteps = prev.steps.map(s =>
                s.id === updatedStep.id ? updatedStep : s
            );

            return {
                ...prev,
                steps: updatedSteps,
                // Explicitly preserve assets - don't let them be overwritten
                assets: prev.assets || {}
            };
        });
    }, []);

    const handleLog = useCallback((log: any) => {
        setLogs(prev => [...prev, log]);
        const message = String(log?.message || '');
        if (!jobId) return;
        if (message.includes('Background removal completed') || message.includes('Background removal failed')) {
            api.getJob(jobId)
                .then((latestJob) => setJob(prev => mergeJobAssets(prev, latestJob)))
                .catch((err) => console.error('Failed to refresh job after BG remove log:', err));
        }
    }, [jobId]);

    useJobSSE(job?.id || null, {
        onJobUpdate: handleJobUpdate,
        onStepUpdate: handleStepUpdate,
        onLog: handleLog
    });

    // Reset logs when jobId changes
    useEffect(() => {
        setLogs([]);
    }, [jobId]);

    // Load job data
    useEffect(() => {
        if (!jobId) {
            setJob(null);
            return;
        }

        const loadJob = async () => {
            try {
                const jobData = await api.getJob(jobId);
                console.log('[API] Loaded job:', {
                    jobId,
                    assetCount: jobData.assets ? Object.keys(jobData.assets).length : 0,
                    stepCount: jobData.steps.length
                });
                setJob(jobData);
            } catch (error) {
                console.error('Failed to load job:', error);
                const msg = error instanceof Error ? error.message : String(error);
                if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
                    localStorage.removeItem('scenehf_last_job');
                    setJob(null);
                    setSelectedStepId(null);
                    onJobCreated(null);
                }
            }
        };

        loadJob();
    }, [jobId]);

    const handlePlan = async () => {
        if (!job) return;

        try {
            const headers = getApiHeaders(settings);

            // Build LLM config
            const llmConfig: Record<string, any> = {
                model: settings.model
            };
            Object.entries(settings.llmParams).forEach(([key, param]) => {
                if (param.enabled) {
                    llmConfig[key] = param.value;
                }
            });

            // Build image config
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel,
                fal_model: settings.falModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) {
                    imageConfig[key] = param.value;
                }
            });

            await api.planJob(job.id, settings.provider, llmConfig, imageConfig, headers);
        } catch (error) {
            console.error('Planning failed:', error);
            alert(`Planning failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleRerunStep = async (stepId: string, customPrompt?: string) => {
        if (!job) return;

        try {
            const headers = getApiHeaders(settings);
            const step = job.steps.find(s => s.id === stepId);
            if (!step) return;

            const prompt = customPrompt || step.custom_prompt || step.prompt;
            const imageConfig = step.image_config || (job.metadata?.image_config || {});

            await api.retryStep(job.id, stepId, prompt, imageConfig, headers);
        } catch (error) {
            console.error('Rerun failed:', error);
        }
    };

    const handleStopStep = async (stepId: string) => {
        if (!job) return;

        try {
            await api.stopStep(job.id, stepId);
        } catch (error) {
            console.error('Stop failed:', error);
        }
    };

    const handleBgRemove = async (stepId: string) => {
        if (!job) return;
        try {
            const headers = getApiHeaders(settings);
            await api.bgRemoveStep(job.id, stepId, headers);
            // Fallback polling so UI updates even if SSE job/step events are delayed or missed.
            const maxAttempts = 60;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const latestJob = await api.getJob(job.id);
                const latestStep = latestJob.steps.find((s) => s.id === stepId);
                const latestAsset = latestStep?.output_asset_id ? latestJob.assets?.[latestStep.output_asset_id] : undefined;
                setJob(prev => mergeJobAssets(prev, latestJob));
                if (latestAsset?.kind === 'BG_REMOVED') {
                    break;
                }
            }
        } catch (error) {
            console.error('BG remove failed:', error);
        }
    };

    const handleClearScene = () => {
        if (confirm('Are you sure you want to clear this scene? This will return you to the upload screen.')) {
            setJob(null);
            setSelectedStepId(null);
            onJobCreated(null); // Clear the job ID in parent
        }
    };

    const currentStep = selectedStepId ? job?.steps.find(s => s.id === selectedStepId) || null : null;

    // No job selected
    if (!jobId || !job) {
        return (
            <div className="h-full flex items-center justify-center bg-[var(--bg)]">
                <UploadCard
                    onJobCreated={onJobCreated}
                    initialFile={prefillImage}
                    onInitialFileUsed={onPrefillImageUsed}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex bg-[var(--bg)]">
            {/* Main 2-Column Layout */}
            <div className="flex-1 flex">
                {/* Center: Scene Editor */}
                <div className="flex-1 flex flex-col min-h-0">
                    <SceneEditor
                        job={job}
                        selectedStep={currentStep}
                        onRunPlan={handlePlan}
                        onRerunStep={handleRerunStep}
                        onBgRemove={handleBgRemove}
                        onClearScene={handleClearScene}
                        onNewScene={() => onJobCreated(null)}
                    />

                    <div className="h-56 border-t border-[var(--border)]">
                        <LogsPanel logs={logs} />
                    </div>
                </div>

                <div className="absolute top-4 right-80 pr-4 z-50">
                    <button
                        onClick={async () => {
                            try {
                                await api.pauseAllJobs();
                                if (job) {
                                    handleJobUpdate({ ...job, status: JobStatus.PAUSED });
                                }
                            } catch (e) {
                                console.error("Failed to pause all", e);
                            }
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--panel)] hover:bg-[var(--panel-contrast)] text-[var(--text)] border border-[var(--border)] rounded-lg text-xs font-semibold transition-all shadow-sm"
                        title="Pause all running requests"
                    >
                        <PauseIcon className="w-3.5 h-3.5" />
                        Pause All Request
                    </button>
                </div>

                {/* Right: Step List */}
                <StepList
                    job={job}
                    selectedStep={currentStep}
                    onSelectStep={(step) => setSelectedStepId(step.id)}
                    onRerunStep={(stepId) => handleRerunStep(stepId)}
                    onStopStep={handleStopStep}
                    onOpenMask={(stepId) => setMaskStepId(stepId)}
                    onBgRemove={handleBgRemove}
                />
            </div>
            {maskStepId && job.steps.find((s) => s.id === maskStepId) && (
                <MaskPopup
                    job={job}
                    step={job.steps.find((s) => s.id === maskStepId)!}
                    onClose={() => setMaskStepId(null)}
                />
            )}
        </div>
    );
}
