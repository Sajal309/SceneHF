import { useState, useEffect, useRef } from 'react';
import { Job, api } from '../../lib/api';
import { ChevronLeftIcon, ChevronRightIcon, ReloadIcon, TrashIcon, DownloadIcon } from '@radix-ui/react-icons';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { ImageWithAspectBadge } from '../common/ImageWithAspectBadge';

interface HistoryPanelProps {
    currentJobId: string | null;
    onLoadJob: (jobId: string | null) => void;
    onGeneratePlanFromReframe?: (file: File) => void;
}

export function HistoryPanel({ currentJobId, onLoadJob, onGeneratePlanFromReframe }: HistoryPanelProps) {
    const { settings } = useSettings();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [editUploading, setEditUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [editDragActive, setEditDragActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editPrompt, setEditPrompt] = useState('');
    const [editFile, setEditFile] = useState<File | null>(null);
    const [editPreviewUrl, setEditPreviewUrl] = useState<string | null>(null);
    const [reframeCollapsed, setReframeCollapsed] = useState(true);
    const [editCollapsed, setEditCollapsed] = useState(true);
    const [planLoadingJobId, setPlanLoadingJobId] = useState<string | null>(null);
    const [locatingJobId, setLocatingJobId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);

    const getDraggedAsset = (e: React.DragEvent) => {
        const raw = e.dataTransfer.getData('application/x-scenehf-asset');
        if (!raw) return null;
        try {
            return JSON.parse(raw) as { jobId: string; assetId: string; filename?: string };
        } catch {
            return null;
        }
    };

    const fileFromAsset = async (jobId: string, assetId: string, filename?: string) => {
        const assetUrl = api.getAssetUrl(jobId, assetId);
        const res = await fetch(assetUrl);
        if (!res.ok) throw new Error('Failed to load image asset');
        const blob = await res.blob();
        const extension = blob.type.split('/')[1] || 'png';
        const name = filename || `${assetId}.${extension}`;
        return new File([blob], name, { type: blob.type || 'image/png' });
    };

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

    const handleDelete = async (e: React.MouseEvent, jobId: string) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this job?")) return;

        try {
            await api.deleteJob(jobId);
            loadJobs();
        } catch (error) {
            console.error('Failed to delete job:', error);
        }
    };

    useEffect(() => {
        loadJobs();
    }, []);

    useEffect(() => {
        return () => {
            if (editPreviewUrl) {
                URL.revokeObjectURL(editPreviewUrl);
            }
        };
    }, [editPreviewUrl]);

    const getSourceImageUrl = (job: Job) => {
        if (job.source_image) {
            return api.getAssetUrl(job.id, job.source_image);
        }
        return null;
    };

    const isReframeJob = (job: Job) => job.steps?.some(step => step.type === 'REFRAME');
    const isEditJob = (job: Job) => job.steps?.some(step => step.type === 'EDIT');
    const reframeJobs = jobs.filter(isReframeJob);
    const editJobs = jobs.filter(isEditJob);
    const otherJobs = jobs.filter(job => !isReframeJob(job) && !isEditJob(job));

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleEditDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setEditDragActive(true);
        } else if (e.type === 'dragleave') {
            setEditDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        const draggedAsset = getDraggedAsset(e);
        if (draggedAsset) {
            fileFromAsset(draggedAsset.jobId, draggedAsset.assetId, draggedAsset.filename)
                .then(handleFile)
                .catch((err) => {
                    console.error('Failed to load dragged asset:', err);
                    setError('Failed to load dragged image');
                });
            return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleEditDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setEditDragActive(false);
        const draggedAsset = getDraggedAsset(e);
        if (draggedAsset) {
            fileFromAsset(draggedAsset.jobId, draggedAsset.assetId, draggedAsset.filename)
                .then(handleEditFile)
                .catch((err) => {
                    console.error('Failed to load dragged asset:', err);
                    setError('Failed to load dragged image');
                });
            return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleEditFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleEditFile(e.target.files[0]);
        }
    };

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }
        setError(null);
        setUploading(true);
        try {
            const { job_id } = await api.createJob(file);
            const headers = getApiHeaders(settings);
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) imageConfig[key] = param.value;
            });
            await api.reframeJob(job_id, imageConfig, headers);
            await loadJobs();
            onLoadJob(job_id);
        } catch (err: any) {
            console.error('Reframe upload failed:', err);
            setError(err.message || 'Failed to reframe image');
        } finally {
            setUploading(false);
        }
    };

    const handleEditFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }
        setError(null);
        setEditFile(file);
        const previewUrl = URL.createObjectURL(file);
        setEditPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return previewUrl;
        });
    };

    const handleEditSubmit = async () => {
        if (!editFile) {
            setError('Please upload an image file');
            return;
        }
        if (!editPrompt.trim()) {
            setError('Please enter a prompt for the edit');
            return;
        }
        setError(null);
        setEditUploading(true);
        try {
            const { job_id } = await api.createJob(editFile);
            const headers = getApiHeaders(settings);
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) imageConfig[key] = param.value;
            });
            await api.editJob(job_id, editPrompt.trim(), imageConfig, headers);
            await loadJobs();
            onLoadJob(job_id);
            setEditFile(null);
            setEditPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
        } catch (err: any) {
            console.error('Edit upload failed:', err);
            setError(err.message || 'Failed to edit image');
        } finally {
            setEditUploading(false);
        }
    };

    const handleGeneratePlanFromReframe = async (
        e: React.MouseEvent,
        job: Job,
        outputAssetId?: string
    ) => {
        e.stopPropagation();
        if (!outputAssetId) {
            setError('Reframe output not ready yet.');
            return;
        }
        if (!onGeneratePlanFromReframe) {
            setError('Generate plan is not available.');
            return;
        }

        setError(null);
        setPlanLoadingJobId(job.id);
        try {
            const assetUrl = api.getAssetUrl(job.id, outputAssetId);
            const res = await fetch(assetUrl);
            if (!res.ok) throw new Error('Failed to load reframed image');
            const blob = await res.blob();
            const extension = blob.type.split('/')[1] || 'png';
            const file = new File([blob], `reframe_${job.id.slice(0, 8)}.${extension}`, {
                type: blob.type || 'image/png'
            });
            onGeneratePlanFromReframe(file);
        } catch (err: any) {
            console.error('Failed to prepare reframe for plan:', err);
            setError(err.message || 'Failed to prepare reframe for plan');
        } finally {
            setPlanLoadingJobId(null);
        }
    };

    const handleLocateFolder = async (e: React.MouseEvent, jobId: string) => {
        e.stopPropagation();
        setError(null);
        setLocatingJobId(jobId);
        try {
            await api.openInFinder(jobId);
        } catch (err: any) {
            console.error('Failed to open generation folder:', err);
            setError(err.message || 'Failed to open generation folder');
        } finally {
            setLocatingJobId(null);
        }
    };

    return (
        <div className={`h-full flex flex-col glass-panel border-l border-[var(--border)] transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-80'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                {!isCollapsed && (
                    <h2 className="text-sm font-semibold text-[var(--text)]">History</h2>
                )}
                <div className="flex items-center gap-2">
                    {!isCollapsed && (
                        <button
                            onClick={loadJobs}
                            disabled={loading}
                            className="p-1.5 hover:bg-[var(--panel-contrast)] rounded transition-colors text-[var(--text-subtle)]"
                            title="Refresh"
                        >
                            <ReloadIcon className={loading ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1.5 hover:bg-[var(--panel-contrast)] rounded transition-colors text-[var(--text-subtle)]"
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
                        {[...reframeJobs, ...otherJobs].slice(0, 10).map((job) => {
                            const imageUrl = getSourceImageUrl(job);
                            return (
                                <button
                                    key={job.id}
                                    onClick={() => onLoadJob(job.id)}
                                    className={`w-12 h-12 rounded overflow-hidden border-2 transition-all hover:scale-110 ${currentJobId === job.id ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                                        }`}
                                    title={`Job ${job.id.slice(0, 8)}`}
                                >
                                    {imageUrl ? (
                                        <ImageWithAspectBadge src={imageUrl} alt="Job" className="w-full h-full object-cover" wrapperClassName="w-full h-full" />
                                    ) : (
                                        <div className="w-full h-full bg-[var(--panel-contrast)] flex items-center justify-center text-[var(--text-subtle)] text-xs">
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
                        <div className="glass-card rounded-xl p-4 space-y-3">
                            <button
                                onClick={() => setReframeCollapsed(!reframeCollapsed)}
                                className="w-full flex items-center justify-between"
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Reframe History</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent-strong)] bg-[var(--accent-soft)]">
                                        Reframe
                                    </span>
                                    <span className="text-xs text-[var(--text-subtle)]">
                                        {reframeCollapsed ? 'Show' : 'Hide'}
                                    </span>
                                </div>
                            </button>
                            {!reframeCollapsed && (
                                <>
                                    <div
                                        className={`border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${dragActive
                                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                            : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                            }`}
                                        onDragEnter={handleDrag}
                                        onDragLeave={handleDrag}
                                        onDragOver={handleDrag}
                                        onDrop={handleDrop}
                                        onClick={() => inputRef.current?.click()}
                                    >
                                        <input
                                            ref={inputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleChange}
                                            className="hidden"
                                        />
                                        <div className="text-xs text-[var(--text-subtle)]">
                                            {uploading ? 'Reframing...' : 'Upload or drop an image to reframe'}
                                        </div>
                                    </div>
                                    {error && (
                                        <div className="text-[11px] text-[var(--danger)]">{error}</div>
                                    )}
                                    <div className="space-y-2">
                                        {reframeJobs.length === 0 && (
                                            <div className="text-xs text-[var(--text-subtle)]">No reframes yet.</div>
                                        )}
                                        {reframeJobs.map((job) => {
                                            const imageUrl = getSourceImageUrl(job);
                                            const stepCount = job.steps?.length || 0;
                                            const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;
                                            const outputAssetId = job.steps?.find(s => s.type === 'REFRAME')?.output_asset_id;
                                            const downloadUrl = outputAssetId ? api.getAssetUrl(job.id, outputAssetId) : null;

                                            return (
                                                <div
                                                    key={job.id}
                                                    className={`rounded-lg border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${currentJobId === job.id
                                                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                                        : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]'
                                                        }`}
                                                    onClick={() => onLoadJob(job.id)}
                                                >
                                                    <div className="relative group/card">
                                                        <button
                                                            onClick={(e) => handleDelete(e, job.id)}
                                                            className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-red-500/80 text-[var(--text)] hover:text-white rounded opacity-0 group-hover/card:opacity-100 transition-all z-10 border border-[var(--border)]"
                                                            title="Delete Job"
                                                        >
                                                            <TrashIcon />
                                                        </button>

                                                        <div className="aspect-video w-full bg-[var(--panel-contrast)] overflow-hidden">
                                                            {imageUrl ? (
                                                                <ImageWithAspectBadge
                                                                    src={imageUrl}
                                                                    alt="Source"
                                                                    className="w-full h-full object-cover"
                                                                    wrapperClassName="w-full h-full"
                                                                    draggable
                                                                    onDragStart={(e) => {
                                                                        e.stopPropagation();
                                                                        if (!job.source_image) return;
                                                                        e.dataTransfer.setData(
                                                                            'application/x-scenehf-asset',
                                                                            JSON.stringify({
                                                                                jobId: job.id,
                                                                                assetId: job.source_image,
                                                                                filename: `source_${job.id.slice(0, 8)}.png`
                                                                            })
                                                                        );
                                                                        e.dataTransfer.effectAllowed = 'copy';
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-[var(--text-subtle)]">
                                                                    No Image
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="p-3 space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigator.clipboard.writeText(job.id);
                                                                    }}
                                                                    className="text-xs font-mono text-[var(--accent-strong)] hover:text-[var(--accent)] underline decoration-dotted"
                                                                    title="Copy job ID"
                                                                >
                                                                    {job.id}
                                                                </button>
                                                                <span className={`text-xs px-2 py-0.5 rounded-full ${job.status === 'DONE' ? 'bg-green-100 text-[var(--success)]' :
                                                                    job.status === 'RUNNING' ? 'bg-blue-100 text-[var(--accent-strong)]' :
                                                                        job.status === 'FAILED' ? 'bg-red-100 text-[var(--danger)]' :
                                                                            'bg-[var(--panel-contrast)] text-[var(--text-subtle)]'
                                                                    }`}>
                                                                    {job.status}
                                                                </span>
                                                            </div>

                                                            {stepCount > 0 && (
                                                                <div className="text-xs text-[var(--text-muted)]">
                                                                    {completedSteps}/{stepCount} steps completed
                                                                </div>
                                                            )}

                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] text-[var(--text-subtle)]">
                                                                    {new Date(job.created_at).toLocaleDateString()}
                                                                </span>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={(e) => handleLocateFolder(e, job.id)}
                                                                        disabled={locatingJobId === job.id}
                                                                        className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                        title="Locate generation folder"
                                                                    >
                                                                        {locatingJobId === job.id ? 'Opening...' : 'Locate Folder'}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleGeneratePlanFromReframe(e, job, outputAssetId)}
                                                                        disabled={!outputAssetId || planLoadingJobId === job.id}
                                                                        className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                        title="Generate plan from this reframe"
                                                                    >
                                                                        {planLoadingJobId === job.id ? 'Preparing...' : 'Generate Plan'}
                                                                    </button>
                                                                    {downloadUrl && (
                                                                        <a
                                                                            href={downloadUrl}
                                                                            download={`reframe_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className="inline-flex items-center gap-2 text-xs text-[var(--success)] hover:text-[var(--accent-strong)] transition-colors"
                                                                            title="Download reframe"
                                                                        >
                                                                            <DownloadIcon />
                                                                            Download
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="glass-card rounded-xl p-4 space-y-3">
                            <button
                                onClick={() => setEditCollapsed(!editCollapsed)}
                                className="w-full flex items-center justify-between"
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Edit History</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent-strong)] bg-[var(--accent-soft)]">
                                        Edit
                                    </span>
                                    <span className="text-xs text-[var(--text-subtle)]">
                                        {editCollapsed ? 'Show' : 'Hide'}
                                    </span>
                                </div>
                            </button>
                            {!editCollapsed && (
                                <>
                                    <div
                                        className={`border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${editDragActive
                                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                            : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                            }`}
                                        onDragEnter={handleEditDrag}
                                        onDragLeave={handleEditDrag}
                                        onDragOver={handleEditDrag}
                                        onDrop={handleEditDrop}
                                        onClick={() => editInputRef.current?.click()}
                                    >
                                        <input
                                            ref={editInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleEditChange}
                                            className="hidden"
                                        />
                                        <div className="text-xs text-[var(--text-subtle)]">
                                            {editUploading ? 'Generating...' : editFile ? editFile.name : 'Upload or drop an image to edit'}
                                        </div>
                                    </div>
                                        <textarea
                                            value={editPrompt}
                                            onChange={(e) => setEditPrompt(e.target.value)}
                                            placeholder="Describe the edit you want..."
                                            className="w-full h-24 bg-[var(--panel-muted)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--text-subtle)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none resize-none"
                                        />
                                        {editPreviewUrl && (
                                            <div className="flex items-center justify-center">
                                                <ImageWithAspectBadge
                                                    src={editPreviewUrl}
                                                    alt="Edit preview"
                                                    className="max-h-24 rounded-md border border-[var(--border)] object-cover"
                                                    wrapperClassName="inline-block"
                                                />
                                            </div>
                                        )}
                                    <button
                                        onClick={handleEditSubmit}
                                        disabled={editUploading || !editPrompt.trim() || !editFile}
                                        className="w-full py-2 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-lg font-semibold text-xs transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                                    >
                                        {editUploading ? 'Generating...' : 'Generate Edit'}
                                    </button>
                                    {error && (
                                        <div className="text-[11px] text-[var(--danger)]">{error}</div>
                                    )}
                                    <div className="space-y-2">
                                        {editJobs.length === 0 && (
                                            <div className="text-xs text-[var(--text-subtle)]">No edits yet.</div>
                                        )}
                                        {editJobs.map((job) => {
                                            const imageUrl = getSourceImageUrl(job);
                                            const stepCount = job.steps?.length || 0;
                                            const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;
                                            const outputAssetId = job.steps?.find(s => s.type === 'EDIT')?.output_asset_id;
                                            const downloadUrl = outputAssetId ? api.getAssetUrl(job.id, outputAssetId) : null;

                                            return (
                                                <div
                                                    key={job.id}
                                                    className={`rounded-lg border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${currentJobId === job.id
                                                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                                        : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]'
                                                        }`}
                                                    onClick={() => onLoadJob(job.id)}
                                                >
                                                    <div className="relative group/card">
                                                        <button
                                                            onClick={(e) => handleDelete(e, job.id)}
                                                            className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-red-500/80 text-[var(--text)] hover:text-white rounded opacity-0 group-hover/card:opacity-100 transition-all z-10 border border-[var(--border)]"
                                                            title="Delete Job"
                                                        >
                                                            <TrashIcon />
                                                        </button>

                                                        <div className="aspect-video w-full bg-[var(--panel-contrast)] overflow-hidden">
                                                            {imageUrl ? (
                                                                <ImageWithAspectBadge
                                                                    src={imageUrl}
                                                                    alt="Source"
                                                                    className="w-full h-full object-cover"
                                                                    wrapperClassName="w-full h-full"
                                                                    draggable
                                                                    onDragStart={(e) => {
                                                                        e.stopPropagation();
                                                                        if (!job.source_image) return;
                                                                        e.dataTransfer.setData(
                                                                            'application/x-scenehf-asset',
                                                                            JSON.stringify({
                                                                                jobId: job.id,
                                                                                assetId: job.source_image,
                                                                                filename: `source_${job.id.slice(0, 8)}.png`
                                                                            })
                                                                        );
                                                                        e.dataTransfer.effectAllowed = 'copy';
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-[var(--text-subtle)]">
                                                                    No Image
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="p-3 space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigator.clipboard.writeText(job.id);
                                                                    }}
                                                                    className="text-xs font-mono text-[var(--accent-strong)] hover:text-[var(--accent)] underline decoration-dotted"
                                                                    title="Copy job ID"
                                                                >
                                                                    {job.id}
                                                                </button>
                                                                <span className={`text-xs px-2 py-0.5 rounded-full ${job.status === 'DONE' ? 'bg-green-100 text-[var(--success)]' :
                                                                    job.status === 'RUNNING' ? 'bg-blue-100 text-[var(--accent-strong)]' :
                                                                        job.status === 'FAILED' ? 'bg-red-100 text-[var(--danger)]' :
                                                                            'bg-[var(--panel-contrast)] text-[var(--text-subtle)]'
                                                                    }`}>
                                                                    {job.status}
                                                                </span>
                                                            </div>

                                                            {stepCount > 0 && (
                                                                <div className="text-xs text-[var(--text-muted)]">
                                                                    {completedSteps}/{stepCount} steps completed
                                                                </div>
                                                            )}

                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] text-[var(--text-subtle)]">
                                                                    {new Date(job.created_at).toLocaleDateString()}
                                                                </span>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={(e) => handleLocateFolder(e, job.id)}
                                                                        disabled={locatingJobId === job.id}
                                                                        className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                        title="Locate generation folder"
                                                                    >
                                                                        {locatingJobId === job.id ? 'Opening...' : 'Locate Folder'}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleGeneratePlanFromReframe(e, job, outputAssetId)}
                                                                        disabled={!outputAssetId || planLoadingJobId === job.id}
                                                                        className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                        title="Generate plan from this edit"
                                                                    >
                                                                        {planLoadingJobId === job.id ? 'Preparing...' : 'Generate Plan'}
                                                                    </button>
                                                                    {downloadUrl && (
                                                                        <a
                                                                            href={downloadUrl}
                                                                            download={`edit_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className="inline-flex items-center gap-2 text-xs text-[var(--success)] hover:text-[var(--accent-strong)] transition-colors"
                                                                            title="Download edit"
                                                                        >
                                                                            <DownloadIcon />
                                                                            Download
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>

                        {otherJobs.map((job) => {
                            const imageUrl = getSourceImageUrl(job);
                            const stepCount = job.steps?.length || 0;
                            const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;
                            const hasReframe = isReframeJob(job);

                            return (
                                <div
                                    key={job.id}
                                    className={`rounded-lg border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${currentJobId === job.id
                                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                        : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]'
                                        }`}
                                    onClick={() => onLoadJob(job.id)}
                                >
                                    <div className="relative group/card">
                                        <button
                                            onClick={(e) => handleDelete(e, job.id)}
                                            className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-red-500/80 text-[var(--text)] hover:text-white rounded opacity-0 group-hover/card:opacity-100 transition-all z-10 border border-[var(--border)]"
                                            title="Delete Job"
                                        >
                                            <TrashIcon />
                                        </button>

                                        {/* Thumbnail */}
                                        <div className="aspect-video w-full bg-[var(--panel-contrast)] overflow-hidden">
                                            {imageUrl ? (
                                                <ImageWithAspectBadge
                                                    src={imageUrl}
                                                    alt="Source"
                                                    className="w-full h-full object-cover"
                                                    wrapperClassName="w-full h-full"
                                                    draggable
                                                    onDragStart={(e) => {
                                                        e.stopPropagation();
                                                        if (!job.source_image) return;
                                                        e.dataTransfer.setData(
                                                            'application/x-scenehf-asset',
                                                            JSON.stringify({
                                                                jobId: job.id,
                                                                assetId: job.source_image,
                                                                filename: `source_${job.id.slice(0, 8)}.png`
                                                            })
                                                        );
                                                        e.dataTransfer.effectAllowed = 'copy';
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[var(--text-subtle)]">
                                                    No Image
                                                </div>
                                            )}
                                        </div>

                                        {/* Details */}
                                        <div className="p-3 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-mono text-[var(--text-subtle)]">
                                                    {job.id.slice(0, 8)}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    {hasReframe && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent-strong)] bg-[var(--accent-soft)]">
                                                            Reframe
                                                        </span>
                                                    )}
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${job.status === 'DONE' ? 'bg-green-100 text-[var(--success)]' :
                                                        job.status === 'RUNNING' ? 'bg-blue-100 text-[var(--accent-strong)]' :
                                                            job.status === 'FAILED' ? 'bg-red-100 text-[var(--danger)]' :
                                                                'bg-[var(--panel-contrast)] text-[var(--text-subtle)]'
                                                        }`}>
                                                        {job.status}
                                                    </span>
                                                </div>
                                            </div>

                                            {stepCount > 0 && (
                                                <div className="text-xs text-[var(--text-muted)]">
                                                    {completedSteps}/{stepCount} steps completed
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] text-[var(--text-subtle)]">
                                                    {new Date(job.created_at).toLocaleDateString()}
                                                </span>
                                                <button
                                                    onClick={(e) => handleLocateFolder(e, job.id)}
                                                    disabled={locatingJobId === job.id}
                                                    className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                    title="Locate generation folder"
                                                >
                                                    {locatingJobId === job.id ? 'Opening...' : 'Locate Folder'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {jobs.length === 0 && !loading && (
                            <div className="text-center py-12 text-[var(--text-subtle)] text-sm">
                                No jobs yet
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
