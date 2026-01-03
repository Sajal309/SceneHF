import { useCallback, useState, useEffect } from 'react';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { api, Job, JobStatus } from '../../lib/api';
import { UploadCard } from '../UploadCard';
import { SceneEditor } from './SceneEditor';
import { StepList } from './StepList';
import { LogsPanel } from '../LogsPanel';
import { PlayIcon } from '@radix-ui/react-icons';
import { useJobSSE } from '../../lib/sse';

interface WorkspaceProps {
    jobId: string | null;
    onJobCreated: (jobId: string) => void;
}

export function Workspace({ jobId, onJobCreated }: WorkspaceProps) {
    const { settings } = useSettings();
    const [job, setJob] = useState<Job | null>(null);
    const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<any[]>([]);

    // SSE for live updates
    const handleJobUpdate = useCallback((updatedJob: Job) => {
        setJob(updatedJob);
    }, []);

    const handleStepUpdate = useCallback((updatedStep: any) => {
        setJob(prev => {
            if (!prev) return null;
            return {
                ...prev,
                steps: prev.steps.map(s => s.id === updatedStep.id ? updatedStep : s)
            };
        });
    }, []);

    const handleLog = useCallback((log: any) => {
        setLogs(prev => [...prev, log]);
    }, []);

    const { isConnected } = useJobSSE(jobId, {
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
                setJob(jobData);
            } catch (error) {
                console.error('Failed to load job:', error);
            }
        };

        loadJob();
    }, [jobId]);

    const handlePlan = async () => {
        if (!job) return;

        setLoading(true);
        try {
            const headers = getApiHeaders(settings);

            // Build LLM config
            const llmConfig: Record<string, any> = {};
            Object.entries(settings.llmParams).forEach(([key, param]) => {
                if (param.enabled) {
                    llmConfig[key] = param.value;
                }
            });

            // Build image config
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
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
        } finally {
            setLoading(false);
        }
    };

    const handleRun = async () => {
        if (!job) return;

        try {
            await api.runJob(job.id);
        } catch (error) {
            console.error('Run failed:', error);
        }
    };

    const handleRerunStep = async (stepId: string, customPrompt?: string) => {
        if (!job) return;

        try {
            const step = job.steps.find(s => s.id === stepId);
            if (!step) return;

            const prompt = customPrompt || step.custom_prompt || step.prompt;
            const imageConfig = step.image_config || (job.metadata?.image_config || {});

            await api.retryStep(job.id, stepId, prompt, imageConfig);
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

    const handleClearScene = () => {
        if (confirm('Are you sure you want to clear this scene? This will return you to the upload screen.')) {
            setJob(null);
            setSelectedStepId(null);
            onJobCreated(null as any); // Clear the job ID in parent
        }
    };

    const currentStep = selectedStepId ? job?.steps.find(s => s.id === selectedStepId) || null : null;

    // No job selected
    if (!jobId || !job) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-950">
                <UploadCard onJobCreated={onJobCreated} />
            </div>
        );
    }

    return (
        <div className="h-full flex bg-gray-950">
            {/* Main 2-Column Layout */}
            <div className="flex-1 flex">
                {/* Center: Scene Editor */}
                <SceneEditor
                    job={job}
                    selectedStep={currentStep}
                    onRunPlan={job.status === 'IDLE' ? handlePlan : handleRun}
                    onRerunStep={handleRerunStep}
                    onClearScene={handleClearScene}
                />

                {/* Right: Step List */}
                <StepList
                    job={job}
                    selectedStep={currentStep}
                    onSelectStep={(step) => setSelectedStepId(step.id)}
                    onRerunStep={(stepId) => handleRerunStep(stepId)}
                    onStopStep={handleStopStep}
                />
            </div>

            {/* Logs Panel (bottom overlay) */}
            {logs.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 max-h-48">
                    <LogsPanel logs={logs} />
                </div>
            )}
        </div>
    );
}
