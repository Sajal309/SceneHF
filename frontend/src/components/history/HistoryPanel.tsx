import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ReloadIcon, ArchiveIcon, TrashIcon } from '@radix-ui/react-icons';

interface JobSummary {
    id: string;
    status: string;
    created_at: string;
    assets?: Record<string, any>;
}

export function HistoryPanel({ onLoadJob }: { onLoadJob: (jobId: string) => void }) {
    const [jobs, setJobs] = useState<JobSummary[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchJobs = async () => {
        setLoading(true);
        try {
            // Need to cast because we haven't updated the api client types yet
            const data = await api.listJobs() as any;
            setJobs(data);
        } catch (e) {
            console.error("Failed to load history", e);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, jobId: string) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this job and all its assets?")) return;

        try {
            await api.deleteJob(jobId);
            fetchJobs();
        } catch (e) {
            console.error("Failed to delete job", e);
            alert("Failed to delete job");
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    // Group by date
    const groupedJobs = jobs.reduce((acc, job) => {
        const date = new Date(job.created_at).toLocaleDateString();
        if (!acc[date]) acc[date] = [];
        acc[date].push(job);
        return acc;
    }, {} as Record<string, JobSummary[]>);

    return (
        <div className="h-full flex flex-col bg-gray-900 border-l border-gray-800 w-72 text-gray-300">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                    <ArchiveIcon /> History
                </h3>
                <button
                    onClick={fetchJobs}
                    className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                >
                    <ReloadIcon className={loading ? "animate-spin" : ""} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-4">
                {Object.entries(groupedJobs).map(([date, dayJobs]) => (
                    <div key={date}>
                        <div className="px-2 py-1 text-xs font-bold text-gray-500 sticky top-0 bg-gray-900/90 backdrop-blur-sm z-10 mb-1">
                            {date}
                        </div>
                        <div className="space-y-1">
                            {dayJobs.map(job => (
                                <button
                                    key={job.id}
                                    onClick={() => onLoadJob(job.id)}
                                    className="w-full text-left p-3 rounded bg-gray-800/50 hover:bg-gray-800 border-l-2 border-transparent hover:border-indigo-500 transition-all group relative"
                                >
                                    <div className="flex justify-between items-start mb-1 pr-6">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${job.status === 'DONE' ? 'bg-green-900/30 text-green-400' :
                                            job.status === 'FAILED' ? 'bg-red-900/30 text-red-400' :
                                                'bg-blue-900/30 text-blue-400'
                                            }`}>
                                            {job.status}
                                        </span>
                                        <span className="text-[10px] text-gray-500">
                                            {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="text-xs truncate text-gray-300 font-medium font-mono pl-1">
                                        {job.id.slice(0, 8)}...
                                    </div>

                                    <button
                                        onClick={(e) => handleDelete(e, job.id)}
                                        className="absolute top-3 right-2 p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Delete Job"
                                    >
                                        <TrashIcon />
                                    </button>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}

                {!loading && jobs.length === 0 && (
                    <div className="text-center py-10 text-gray-600 text-sm">
                        No history found
                    </div>
                )}
            </div>

            <div className="p-3 border-t border-gray-800">
                <button className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-xs font-medium rounded transition-colors text-gray-300">
                    Export All (Zip)
                </button>
            </div>
        </div>
    );
}
