import { useCallback, useState, useEffect } from 'react';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { api, Job, JobStatus } from '../../lib/api';
import { UploadCard } from '../UploadCard';
import { StepTimeline } from '../StepTimeline';
import { PreviewPane } from '../PreviewPane';
import { StepActions } from '../StepActions';
import { LogsPanel } from '../LogsPanel';
import { PlayIcon, RocketIcon } from '@radix-ui/react-icons';
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

    // Load job initially
    useEffect(() => {
        if (jobId) {
            api.getJob(jobId).then(setJob).catch(console.error);
        } else {
            setJob(null);
        }
    }, [jobId]);

    const handleFileUpload = async (file: File) => {
        setLoading(true);
        try {
            const { job_id } = await api.createJob(file);
            onJobCreated(job_id);
        } catch (e) {
            console.error(e);
            alert("Upload failed");
        } finally {
            setLoading(false);
        }
    };

    const handlePlan = async () => {
        if (!jobId) return;
        setLoading(true);
        try {
            const headers = getApiHeaders(settings);

            // Collect enabled LLM params
            const modelConfig: Record<string, any> = {
                model: settings.model
            };
            Object.entries(settings.llmParams).forEach(([key, param]) => {
                if (param.enabled) modelConfig[key] = param.value;
            });

            // Collect enabled Image params
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) imageConfig[key] = param.value;
            });

            await api.planJob(jobId, settings.provider, modelConfig, imageConfig, headers);
        } catch (e) {
            console.error(e);
            alert("Planning failed");
        } finally {
            setLoading(false);
        }
    };

    const handleRun = async () => {
        if (!jobId) return;
        try {
            await api.runJob(jobId);
        } catch (e) {
            console.error(e);
            alert("Run failed");
        }
    };

    const handleExport = async () => {
        if (!jobId) return;
        window.open(api.getExportUrl(jobId), '_blank');
    };

    if (!jobId) {
        return (
            <div className="flex-1 flex items-center justify-center p-10">
                <div className="w-full max-w-xl">
                    <UploadCard onUpload={handleFileUpload} uploading={loading} error={null} />
                    <p className="text-center text-gray-500 mt-4 text-sm">
                        Drag & drop an image to start a new project
                    </p>
                </div>
            </div>
        );
    }

    if (!job) return <div className="text-center pt-20 text-gray-500">Loading workspace...</div>;

    const currentStep = job.steps.find(s => s.id === selectedStepId) || job.steps[0];

    return (
        <div className="flex h-full flex-col">
            {/* Top Bar */}
            <div className="h-14 border-b border-gray-800 flex items-center justify-between px-4 bg-gray-900/50 backdrop-blur">
                <div className="flex items-center gap-4">
                    <h2 className="font-semibold text-sm text-gray-200">
                        Job: <span className="font-mono text-gray-400">{jobId.slice(0, 8)}</span>
                    </h2>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${job.status === JobStatus.RUNNING ? 'bg-indigo-500/20 text-indigo-400 animate-pulse' :
                        job.status === JobStatus.DONE ? 'bg-green-500/20 text-green-400' :
                            'bg-gray-700 text-gray-400'
                        }`}>
                        {job.status}
                    </span>
                    <span className={`text-xs flex items-center gap-1 ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
                        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                        {isConnected ? 'Live' : 'Disconnected'}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {job.status !== JobStatus.RUNNING && (
                        <button
                            onClick={handlePlan}
                            disabled={loading}
                            className={`flex items-center gap-2 px-4 py-1.5 ${job.status === JobStatus.IDLE ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-700 hover:bg-gray-600'} text-white rounded text-sm font-medium transition-colors disabled:opacity-50`}
                        >
                            <RocketIcon /> {loading ? 'Planning...' : job.status === JobStatus.IDLE ? 'Generate Plan' : 'Update Config'}
                        </button>
                    )}

                    {(job.status === JobStatus.PLANNED || job.status === JobStatus.PAUSED || job.status === JobStatus.FAILED) && (
                        <button
                            onClick={handleRun}
                            className={`flex items-center gap-2 px-4 py-1.5 ${job.status === JobStatus.PLANNED ? 'bg-green-600 hover:bg-green-500' : 'bg-amber-600 hover:bg-amber-500'} text-white rounded text-sm font-medium transition-colors`}
                        >
                            <PlayIcon /> {job.status === JobStatus.PLANNED ? 'Start Process' : 'Resume Progress'}
                        </button>
                    )}

                    <button
                        onClick={handleExport}
                        className="px-3 py-1.5 border border-gray-700 hover:border-gray-600 text-gray-300 rounded text-sm transition-colors"
                    >
                        Export
                    </button>
                </div>
            </div>

            {/* 3-Column Content Area */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

                {/* Left: Process Flow */}
                <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900/30">
                    <div className="flex-1 overflow-y-auto p-4">
                        <StepTimeline
                            jobId={jobId}
                            steps={job.steps}
                            selectedStep={currentStep}
                            onSelectStep={(step) => setSelectedStepId(step.id)}
                        />
                    </div>
                    {/* Dynamic Logs Panel at bottom left */}
                    <div className="h-48 border-t border-gray-800">
                        <LogsPanel logs={logs} className="h-full text-[10px]" />
                    </div>
                </div>

                {/* Center: Preview Canvas */}
                <div className="flex-1 bg-black/50 p-6 flex flex-col min-w-0 overflow-hidden">
                    {currentStep ? (
                        <PreviewPane
                            step={currentStep}
                            job={job}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-600">
                            Select a step to view details
                        </div>
                    )}
                </div>

                {/* Right: Actions & Details */}
                {currentStep && (
                    <div className="w-80 border-l border-gray-800 bg-gray-900/30 p-4 overflow-y-auto">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">
                            Step Configuration
                        </h3>

                        <div className="space-y-6">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Prompt</label>
                                <div className="text-sm bg-black/40 p-3 rounded border border-gray-800 text-gray-300 font-medium">
                                    {currentStep.custom_prompt || currentStep.prompt}
                                </div>
                            </div>

                            <StepActions
                                jobId={jobId}
                                step={currentStep}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
