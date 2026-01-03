import { useState, useEffect } from 'react';
import { Job, api } from '../../lib/api';
import { ChevronLeftIcon, ChevronRightIcon, ReloadIcon } from '@radix-ui/react-icons';

interface HistoryPanelProps {
    currentJobId: string | null;
    onLoadJob: (jobId: string) => void;
}

export function HistoryPanel({ currentJobId, onLoadJob }: HistoryPanelProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(false);

    const loadJobs = async () => {
        setLoading(true);
        try {
            const jobList = await api.listJobs();
            setJobs(jobList);

            // Persist to localStorage
            localStorage.setItem('scenehf_job_history', JSON.stringify(jobList.map(j => j.id)));
        } catch (error) {
            console.error('Failed to load jobs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadJobs();
    }, []);

    const getSourceImageUrl = (job: Job) => {
        if (job.source_image) {
            return api.getAssetUrl(job.id, job.source_image);
        }
        return null;
    };

    return (
        <div className={`h-full flex flex-col bg-gray-900 border-l border-gray-800 transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-80'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
                {!isCollapsed && (
                    <h2 className="text-sm font-semibold text-gray-300">History</h2>
                )}
                <div className="flex items-center gap-2">
                    {!isCollapsed && (
                        <button
                            onClick={loadJobs}
                            disabled={loading}
                            className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400"
                            title="Refresh"
                        >
                            <ReloadIcon className={loading ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400"
                        title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                        {isCollapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    </button>
                </div>
            </div>

            {/* Job List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {isCollapsed ? (
                    // Collapsed view: vertical thumbnails
                    <div className="flex flex-col items-center gap-2 p-2">
                        {jobs.slice(0, 10).map((job) => {
                            const imageUrl = getSourceImageUrl(job);
                            return (
                                <button
                                    key={job.id}
                                    onClick={() => onLoadJob(job.id)}
                                    className={`w-12 h-12 rounded overflow-hidden border-2 transition-all hover:scale-110 ${currentJobId === job.id ? 'border-indigo-500' : 'border-gray-700 hover:border-gray-600'
                                        }`}
                                    title={`Job ${job.id.slice(0, 8)}`}
                                >
                                    {imageUrl ? (
                                        <img src={imageUrl} alt="Job" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-600 text-xs">
                                            ?
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    // Expanded view: cards with details
                    <div className="p-3 space-y-2">
                        {jobs.map((job) => {
                            const imageUrl = getSourceImageUrl(job);
                            const stepCount = job.steps?.length || 0;
                            const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;

                            return (
                                <div
                                    key={job.id}
                                    className={`rounded-lg border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${currentJobId === job.id
                                            ? 'border-indigo-500 bg-indigo-500/10'
                                            : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                                        }`}
                                    onClick={() => onLoadJob(job.id)}
                                >
                                    {/* Thumbnail */}
                                    <div className="aspect-video w-full bg-gray-800 overflow-hidden">
                                        {imageUrl ? (
                                            <img src={imageUrl} alt="Source" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                No Image
                                            </div>
                                        )}
                                    </div>

                                    {/* Details */}
                                    <div className="p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-mono text-gray-500">
                                                {job.id.slice(0, 8)}
                                            </span>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${job.status === 'DONE' ? 'bg-green-500/20 text-green-400' :
                                                    job.status === 'RUNNING' ? 'bg-blue-500/20 text-blue-400' :
                                                        job.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                                                            'bg-gray-700 text-gray-400'
                                                }`}>
                                                {job.status}
                                            </span>
                                        </div>

                                        {stepCount > 0 && (
                                            <div className="text-xs text-gray-400">
                                                {completedSteps}/{stepCount} steps completed
                                            </div>
                                        )}

                                        <div className="text-[10px] text-gray-600">
                                            {new Date(job.created_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {jobs.length === 0 && !loading && (
                            <div className="text-center py-12 text-gray-600 text-sm">
                                No jobs yet
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
