import { useState, useEffect, useRef } from 'react';
import { AssetKind, Job, api } from '../../lib/api';
import { ChevronLeftIcon, ChevronRightIcon, ReloadIcon, TrashIcon, DownloadIcon, MagicWandIcon, CropIcon, TransparencyGridIcon } from '@radix-ui/react-icons';
import { useSettings, getApiHeaders } from '../../context/SettingsContext';
import { ImageWithAspectBadge } from '../common/ImageWithAspectBadge';

function FolderGlyph({ className = 'h-4 w-4' }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path d="M1.5 5A1.5 1.5 0 0 1 3 3.5h2.2a1.3 1.3 0 0 1 1.05.52l.5.7c.09.12.23.2.38.2H13A1.5 1.5 0 0 1 14.5 6.5V11A1.5 1.5 0 0 1 13 12.5H3A1.5 1.5 0 0 1 1.5 11V5Z" />
        </svg>
    );
}

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
    const [upscaleUploading, setUpscaleUploading] = useState(false);
    const [editUploading, setEditUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [upscaleDragActive, setUpscaleDragActive] = useState(false);
    const [editDragActive, setEditDragActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editPrompt, setEditPrompt] = useState('');
    const [editFile, setEditFile] = useState<File | null>(null);
    const [editPreviewUrl, setEditPreviewUrl] = useState<string | null>(null);
    const [reframeCollapsed, setReframeCollapsed] = useState(true);
    const [upscaleCollapsed, setUpscaleCollapsed] = useState(true);
    const [editCollapsed, setEditCollapsed] = useState(true);
    const [bgToolsCollapsed, setBgToolsCollapsed] = useState(true);
    const [segmentationCollapsed, setSegmentationCollapsed] = useState(true);
    const [upscaleFactor, setUpscaleFactor] = useState(2);
    const [planLoadingJobId, setPlanLoadingJobId] = useState<string | null>(null);
    const [locatingJobId, setLocatingJobId] = useState<string | null>(null);
    const [bgRemovingJobId, setBgRemovingJobId] = useState<string | null>(null);
    const [bgToolUploading, setBgToolUploading] = useState(false);
    const [bgToolDragActive, setBgToolDragActive] = useState(false);
    const [trimmingAssetKey, setTrimmingAssetKey] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const upscaleInputRef = useRef<HTMLInputElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);
    const bgInputRef = useRef<HTMLInputElement>(null);

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

    const getImageConfig = () => {
        const imageConfig: Record<string, any> = {
            provider: settings.imageProvider,
            model: settings.imageModel,
            fal_model: settings.falModel
        };
        Object.entries(settings.imageParams).forEach(([key, param]) => {
            if (param.enabled) imageConfig[key] = param.value;
        });
        return imageConfig;
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitForStepTerminal = async (
        jobId: string,
        stepId: string,
        successStates: string[] = ['SUCCESS', 'NEEDS_REVIEW'],
        timeoutMs = 240000
    ) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const job = await api.getJob(jobId);
            const step = (job.steps || []).find((s) => s.id === stepId);
            if (!step) {
                throw new Error('Step not found while waiting for completion');
            }
            if (successStates.includes(step.status)) {
                return step;
            }
            if (step.status === 'FAILED' || step.status === 'CANCELLED' || step.status === 'SKIPPED') {
                throw new Error(`Step failed (${step.status})`);
            }
            await sleep(1200);
        }
        throw new Error('Step timed out');
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
    const isUpscaleJob = (job: Job) => job.steps?.some(step => step.type === 'UPSCALE');
    const isEditJob = (job: Job) => job.steps?.some(step => step.type === 'EDIT');
    const reframeJobs = jobs.filter(isReframeJob);
    const upscaleJobs = jobs.filter(isUpscaleJob);
    const editJobs = jobs.filter(isEditJob);
    const otherJobs = jobs.filter(job => !isReframeJob(job) && !isEditJob(job) && !isUpscaleJob(job));

    const getLatestGeneratedAssetId = (job: Job, stepType: 'REFRAME' | 'EDIT' | 'UPSCALE') => {
        const typeSteps = (job.steps || []).filter((s) => s.type === stepType);
        if (!typeSteps.length) return undefined;

        // Prefer explicit output asset on the latest step of this type.
        const latestTypeStep = typeSteps[typeSteps.length - 1];
        if (latestTypeStep.output_asset_id) return latestTypeStep.output_asset_id;

        // Fallback to outputs history (latest first).
        const outputs = latestTypeStep.outputs_history || [];
        if (outputs.length) return outputs[outputs.length - 1];

        // Last resort: any asset linked to this step id (latest by created_at).
        const candidates = Object.values(job.assets || {}).filter((asset) => asset.step_id === latestTypeStep.id);
        if (!candidates.length) return undefined;
        candidates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return candidates[0].id;
    };

    const getLatestBgRemovedPair = (job: Job, stepType?: 'REFRAME' | 'EDIT') => {
        const steps = stepType
            ? (job.steps || []).filter((step) => step.type === stepType)
            : (job.steps || []);
        for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
            const step = steps[stepIndex];
            const ids = [...(step.outputs_history || [])];
            if (step.output_asset_id && ids[ids.length - 1] !== step.output_asset_id) {
                ids.push(step.output_asset_id);
            }

            let bgRemovedAssetId: string | undefined;
            for (let i = ids.length - 1; i >= 0; i -= 1) {
                const candidate = job.assets?.[ids[i]];
                if (candidate?.kind === AssetKind.BG_REMOVED) {
                    bgRemovedAssetId = candidate.id;
                    break;
                }
            }
            if (!bgRemovedAssetId) continue;

            let originalAssetId: string | undefined;
            for (let i = ids.length - 1; i >= 0; i -= 1) {
                const candidate = job.assets?.[ids[i]];
                if (candidate?.id !== bgRemovedAssetId && candidate?.kind !== AssetKind.BG_REMOVED) {
                    originalAssetId = candidate.id;
                    break;
                }
            }
            if (!originalAssetId && step.input_asset_id) {
                originalAssetId = step.input_asset_id;
            }

            return { bgRemovedAssetId, originalAssetId };
        }
        return null;
    };

    const getTrimmedAssetId = (job: Job, bgRemovedAssetId?: string) => {
        if (!bgRemovedAssetId) return undefined;
        const map = job.metadata?.alpha_trimmed_assets as Record<string, string> | undefined;
        const trimmedId = map?.[bgRemovedAssetId];
        if (trimmedId && job.assets?.[trimmedId]) {
            return trimmedId;
        }
        return undefined;
    };

    const bgRemovalJobs = jobs
        .filter((job) => !!getLatestBgRemovedPair(job))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    const isStepCompleted = (status: string) => status === 'SUCCESS' || status === 'NEEDS_REVIEW';

    const summarizeSectionJobs = (sectionJobs: Job[], isCompleted: (job: Job) => boolean) => ({
        doneCount: sectionJobs.filter(isCompleted).length,
        hasRunning: sectionJobs.some((job) => job.status === 'RUNNING')
    });

    const reframeSummary = summarizeSectionJobs(
        reframeJobs,
        (job) => (job.steps || []).some((step) => step.type === 'REFRAME' && isStepCompleted(step.status))
    );
    const upscaleSummary = summarizeSectionJobs(
        upscaleJobs,
        (job) => (job.steps || []).some((step) => step.type === 'UPSCALE' && isStepCompleted(step.status))
    );
    const editSummary = summarizeSectionJobs(
        editJobs,
        (job) => (job.steps || []).some((step) => step.type === 'EDIT' && isStepCompleted(step.status))
    );
    const bgRemoveSummary = summarizeSectionJobs(
        bgRemovalJobs,
        (job) => !!getLatestBgRemovedPair(job)
    );
    const segmentationSummary = summarizeSectionJobs(
        otherJobs,
        (job) => (job.steps || []).some((step) => isStepCompleted(step.status))
    );

    const iconActionButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
    const iconDownloadButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--success)] hover:text-[var(--accent-strong)] hover:bg-[var(--border)] transition-colors';
    const miniIconActionButtonClass = 'mt-2 inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
    const miniIconDownloadButtonClass = 'mt-2 inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--success)] hover:text-[var(--accent-strong)] hover:bg-[var(--border)] transition-colors';

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleUpscaleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setUpscaleDragActive(true);
        } else if (e.type === 'dragleave') {
            setUpscaleDragActive(false);
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

    const handleBgToolDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setBgToolDragActive(true);
        } else if (e.type === 'dragleave') {
            setBgToolDragActive(false);
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

    const handleUpscaleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setUpscaleDragActive(false);
        const draggedAsset = getDraggedAsset(e);
        if (draggedAsset) {
            fileFromAsset(draggedAsset.jobId, draggedAsset.assetId, draggedAsset.filename)
                .then(handleUpscaleFile)
                .catch((err) => {
                    console.error('Failed to load dragged asset:', err);
                    setError('Failed to load dragged image');
                });
            return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleUpscaleFile(e.dataTransfer.files[0]);
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

    const handleBgToolDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setBgToolDragActive(false);
        const draggedAsset = getDraggedAsset(e);
        if (draggedAsset) {
            fileFromAsset(draggedAsset.jobId, draggedAsset.assetId, draggedAsset.filename)
                .then(handleBgToolFile)
                .catch((err) => {
                    console.error('Failed to load dragged asset:', err);
                    setError('Failed to load dragged image');
                });
            return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleBgToolFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleUpscaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleUpscaleFile(e.target.files[0]);
        }
    };

    const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleEditFile(e.target.files[0]);
        }
    };

    const handleBgToolChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleBgToolFile(e.target.files[0]);
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
            const imageConfig = getImageConfig();
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

    const handleUpscaleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }
        setError(null);
        setUpscaleUploading(true);
        try {
            const { job_id } = await api.createJob(file);
            const headers = getApiHeaders(settings);
            const result = await api.upscaleSource(job_id, settings.upscaleModel, upscaleFactor, headers);
            await waitForStepTerminal(job_id, result.step_id, ['SUCCESS', 'NEEDS_REVIEW']);
            await loadJobs();
            onLoadJob(job_id);
        } catch (err: any) {
            console.error('Upscale upload failed:', err);
            setError(err.message || 'Failed to upscale image');
        } finally {
            setUpscaleUploading(false);
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
            const imageConfig = getImageConfig();
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

    const handleBgToolFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }

        setError(null);
        setBgToolUploading(true);
        try {
            const { job_id } = await api.createJob(file);
            const headers = getApiHeaders(settings);
            const result = await api.bgRemoveSource(job_id, settings.falModel, headers);
            await waitForStepTerminal(job_id, result.step_id, ['SUCCESS', 'NEEDS_REVIEW']);
            await loadJobs();
            onLoadJob(job_id);
        } catch (err: any) {
            console.error('Background removal upload failed:', err);
            setError(err.message || 'Failed to remove background');
        } finally {
            setBgToolUploading(false);
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

    const handleRemoveBgForEditJob = async (e: React.MouseEvent, job: Job) => {
        e.stopPropagation();
        const editSteps = (job.steps || []).filter((step) => step.type === 'EDIT');
        const latestEditStep = editSteps[editSteps.length - 1];
        if (!latestEditStep?.output_asset_id) {
            setError('No edit output available yet for background removal.');
            return;
        }

        setError(null);
        setBgRemovingJobId(job.id);
        try {
            const headers = getApiHeaders(settings);
            await api.bgRemoveStep(job.id, latestEditStep.id, headers);
            await loadJobs();
            onLoadJob(job.id);
        } catch (err: any) {
            console.error('Failed to remove background:', err);
            setError(err.message || 'Failed to remove background');
        } finally {
            setBgRemovingJobId(null);
        }
    };

    const handleTrimAlpha = async (e: React.MouseEvent, job: Job, bgRemovedAssetId: string) => {
        e.stopPropagation();
        const assetKey = `${job.id}:${bgRemovedAssetId}`;
        setError(null);
        setTrimmingAssetKey(assetKey);
        try {
            await api.trimAlphaAsset(job.id, bgRemovedAssetId);
            await loadJobs();
            onLoadJob(job.id);
        } catch (err: any) {
            console.error('Failed to trim alpha:', err);
            setError(err.message || 'Failed to resize image');
        } finally {
            setTrimmingAssetKey(null);
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
                        {[...reframeJobs, ...upscaleJobs, ...otherJobs].slice(0, 10).map((job) => {
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
                                        <ImageWithAspectBadge src={imageUrl} alt="Job" className="w-full h-full object-contain" wrapperClassName="w-full h-full" />
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
                                <div className="text-sm font-semibold text-[var(--text)]">Reframe</div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm ${reframeSummary.hasRunning ? 'bg-blue-500' : 'bg-green-500'
                                            }`}
                                        title={reframeSummary.hasRunning ? 'Work in progress' : 'Done'}
                                    />
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/80 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm">
                                        {reframeSummary.doneCount}
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
                                            const outputAssetId = getLatestGeneratedAssetId(job, 'REFRAME');
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
                                                                    className="w-full h-full object-contain"
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
                                                                        className={iconActionButtonClass}
                                                                        title={locatingJobId === job.id ? 'Opening folder...' : 'Locate folder'}
                                                                        aria-label={locatingJobId === job.id ? 'Opening folder' : 'Locate folder'}
                                                                    >
                                                                        {locatingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <FolderGlyph />}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleGeneratePlanFromReframe(e, job, outputAssetId)}
                                                                        disabled={!outputAssetId || planLoadingJobId === job.id}
                                                                        className={iconActionButtonClass}
                                                                        title={planLoadingJobId === job.id ? 'Preparing plan...' : 'Generate plan from this reframe'}
                                                                        aria-label={planLoadingJobId === job.id ? 'Preparing plan' : 'Generate plan'}
                                                                    >
                                                                        {planLoadingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <MagicWandIcon />}
                                                                    </button>
                                                                    {downloadUrl && (
                                                                        <a
                                                                            href={downloadUrl}
                                                                            download={`reframe_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={iconDownloadButtonClass}
                                                                            title="Download reframe"
                                                                            aria-label="Download reframe"
                                                                        >
                                                                            <DownloadIcon />
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
                                onClick={() => setUpscaleCollapsed(!upscaleCollapsed)}
                                className="w-full flex items-center justify-between"
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Upscale</div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm ${upscaleSummary.hasRunning ? 'bg-blue-500' : 'bg-green-500'
                                            }`}
                                        title={upscaleSummary.hasRunning ? 'Work in progress' : 'Done'}
                                    />
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/80 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm">
                                        {upscaleSummary.doneCount}
                                    </span>
                                    <span className="text-xs text-[var(--text-subtle)]">
                                        {upscaleCollapsed ? 'Show' : 'Hide'}
                                    </span>
                                </div>
                            </button>
                            {!upscaleCollapsed && (
                                <>
                                    <div
                                        className={`border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${upscaleDragActive
                                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                            : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                            }`}
                                        onDragEnter={handleUpscaleDrag}
                                        onDragLeave={handleUpscaleDrag}
                                        onDragOver={handleUpscaleDrag}
                                        onDrop={handleUpscaleDrop}
                                        onClick={() => upscaleInputRef.current?.click()}
                                    >
                                        <input
                                            ref={upscaleInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleUpscaleChange}
                                            className="hidden"
                                        />
                                        <div className="text-xs text-[var(--text-subtle)]">
                                            {upscaleUploading ? 'Upscaling...' : 'Upload or drop an image to upscale'}
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-[var(--text)]">Upscale Factor</span>
                                            <span className="text-xs font-bold text-[var(--accent-strong)]">{upscaleFactor}x</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="1"
                                            max="6"
                                            step="1"
                                            value={upscaleFactor}
                                            onChange={(e) => setUpscaleFactor(parseInt(e.target.value, 10))}
                                            className="w-full h-2 bg-[var(--panel-contrast)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                                        />
                                        <div className="flex items-center justify-between text-[10px] text-[var(--text-subtle)]">
                                            <span>1x</span>
                                            <span>2x</span>
                                            <span>3x</span>
                                            <span>4x</span>
                                            <span>5x</span>
                                            <span>6x</span>
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="text-[11px] text-[var(--danger)]">{error}</div>
                                    )}

                                    <div className="space-y-2">
                                        {upscaleJobs.length === 0 && (
                                            <div className="text-xs text-[var(--text-subtle)]">No upscales yet.</div>
                                        )}
                                        {upscaleJobs.map((job) => {
                                            const imageUrl = getSourceImageUrl(job);
                                            const stepCount = job.steps?.length || 0;
                                            const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;
                                            const outputAssetId = getLatestGeneratedAssetId(job, 'UPSCALE');
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
                                                                    className="w-full h-full object-contain"
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
                                                                        className={iconActionButtonClass}
                                                                        title={locatingJobId === job.id ? 'Opening folder...' : 'Locate folder'}
                                                                        aria-label={locatingJobId === job.id ? 'Opening folder' : 'Locate folder'}
                                                                    >
                                                                        {locatingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <FolderGlyph />}
                                                                    </button>
                                                                    {downloadUrl && (
                                                                        <a
                                                                            href={downloadUrl}
                                                                            download={`upscale_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={iconDownloadButtonClass}
                                                                            title="Download upscale"
                                                                            aria-label="Download upscale"
                                                                        >
                                                                            <DownloadIcon />
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
                                <div className="text-sm font-semibold text-[var(--text)]">Edit</div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm ${editSummary.hasRunning ? 'bg-blue-500' : 'bg-green-500'
                                            }`}
                                        title={editSummary.hasRunning ? 'Work in progress' : 'Done'}
                                    />
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/80 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm">
                                        {editSummary.doneCount}
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
                                                    className="max-h-24 rounded-md border border-[var(--border)] object-contain"
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
                                            const outputAssetId = getLatestGeneratedAssetId(job, 'EDIT');
                                            const bgPair = getLatestBgRemovedPair(job, 'EDIT');
                                            const latestEditStep = (job.steps || []).filter((step) => step.type === 'EDIT').slice(-1)[0];
                                            const canRemoveBg = !!latestEditStep?.output_asset_id;
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
                                                                    className="w-full h-full object-contain"
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
                                                                        className={iconActionButtonClass}
                                                                        title={locatingJobId === job.id ? 'Opening folder...' : 'Locate folder'}
                                                                        aria-label={locatingJobId === job.id ? 'Opening folder' : 'Locate folder'}
                                                                    >
                                                                        {locatingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <FolderGlyph />}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleGeneratePlanFromReframe(e, job, outputAssetId)}
                                                                        disabled={!outputAssetId || planLoadingJobId === job.id}
                                                                        className={iconActionButtonClass}
                                                                        title={planLoadingJobId === job.id ? 'Preparing plan...' : 'Generate plan from this edit'}
                                                                        aria-label={planLoadingJobId === job.id ? 'Preparing plan' : 'Generate plan'}
                                                                    >
                                                                        {planLoadingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <MagicWandIcon />}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleRemoveBgForEditJob(e, job)}
                                                                        disabled={!canRemoveBg || bgRemovingJobId === job.id}
                                                                        className={iconActionButtonClass}
                                                                        title={bgRemovingJobId === job.id ? 'Removing background...' : 'Remove background from latest edit output'}
                                                                        aria-label={bgRemovingJobId === job.id ? 'Removing background' : 'Remove background'}
                                                                    >
                                                                        {bgRemovingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <TransparencyGridIcon />}
                                                                    </button>
                                                                    {downloadUrl && (
                                                                        <a
                                                                            href={downloadUrl}
                                                                            download={`edit_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={iconDownloadButtonClass}
                                                                            title="Download edit"
                                                                            aria-label="Download edit"
                                                                        >
                                                                            <DownloadIcon />
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {bgPair?.bgRemovedAssetId && (
                                                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)]">
                                                                    {bgPair.originalAssetId && (
                                                                        <div className="rounded-md border border-[var(--border)] p-2 bg-[var(--panel-contrast)]">
                                                                            <div className="text-[10px] text-[var(--text-subtle)] mb-1">Original</div>
                                                                            <ImageWithAspectBadge
                                                                                src={api.getAssetUrl(job.id, bgPair.originalAssetId)}
                                                                                alt="Original"
                                                                                className="w-full h-16 object-contain rounded"
                                                                                wrapperClassName="w-full"
                                                                            />
                                                                            <a
                                                                                href={api.getAssetUrl(job.id, bgPair.originalAssetId)}
                                                                                download={`original_${job.id.slice(0, 8)}.png`}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                className={miniIconDownloadButtonClass}
                                                                                title="Download original"
                                                                                aria-label="Download original"
                                                                            >
                                                                                <DownloadIcon />
                                                                            </a>
                                                                        </div>
                                                                    )}
                                                                    <div className="rounded-md border border-[var(--border)] p-2 bg-[var(--panel-contrast)]">
                                                                        <div className="text-[10px] text-[var(--text-subtle)] mb-1">BG Removed</div>
                                                                        <ImageWithAspectBadge
                                                                            src={api.getAssetUrl(job.id, bgPair.bgRemovedAssetId)}
                                                                            alt="BG removed"
                                                                            className="w-full h-16 object-contain rounded"
                                                                            wrapperClassName="w-full"
                                                                        />
                                                                        <a
                                                                            href={api.getAssetUrl(job.id, bgPair.bgRemovedAssetId)}
                                                                            download={`bg_removed_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={miniIconDownloadButtonClass}
                                                                            title="Download background removed image"
                                                                            aria-label="Download background removed image"
                                                                        >
                                                                            <DownloadIcon />
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                            )}
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
                                onClick={() => setBgToolsCollapsed(!bgToolsCollapsed)}
                                className="w-full flex items-center justify-between"
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">BG Remove</div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm ${bgRemoveSummary.hasRunning ? 'bg-blue-500' : 'bg-green-500'
                                            }`}
                                        title={bgRemoveSummary.hasRunning ? 'Work in progress' : 'Done'}
                                    />
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/80 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm">
                                        {bgRemoveSummary.doneCount}
                                    </span>
                                    <span className="text-xs text-[var(--text-subtle)]">
                                        {bgToolsCollapsed ? 'Show' : 'Hide'}
                                    </span>
                                </div>
                            </button>
                            {!bgToolsCollapsed && (
                                <>
                                    <div
                                        className={`border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${bgToolDragActive
                                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                            : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                            }`}
                                        onDragEnter={handleBgToolDrag}
                                        onDragLeave={handleBgToolDrag}
                                        onDragOver={handleBgToolDrag}
                                        onDrop={handleBgToolDrop}
                                        onClick={() => bgInputRef.current?.click()}
                                    >
                                        <input
                                            ref={bgInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleBgToolChange}
                                            className="hidden"
                                        />
                                        <div className="text-xs text-[var(--text-subtle)]">
                                            {bgToolUploading ? 'Removing background...' : 'Upload or drop an image to remove background'}
                                        </div>
                                    </div>
                                    {error && (
                                        <div className="text-[11px] text-[var(--danger)]">{error}</div>
                                    )}
                                    <div className="space-y-2">
                                        {bgRemovalJobs.length === 0 && (
                                            <div className="text-xs text-[var(--text-subtle)]">No background-removed images yet.</div>
                                        )}
                                        {bgRemovalJobs.map((job) => {
                                            const bgPair = getLatestBgRemovedPair(job);
                                            if (!bgPair?.bgRemovedAssetId) return null;

                                            const trimmedAssetId = getTrimmedAssetId(job, bgPair.bgRemovedAssetId);
                                            const isTrimming = trimmingAssetKey === `${job.id}:${bgPair.bgRemovedAssetId}`;
                                            const imageUrl = getSourceImageUrl(job);
                                            const stepCount = job.steps?.length || 0;
                                            const completedSteps = job.steps?.filter((s) => s.status === 'SUCCESS').length || 0;

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
                                                                    className="w-full h-full object-contain"
                                                                    wrapperClassName="w-full h-full"
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
                                                                <button
                                                                    onClick={(e) => handleLocateFolder(e, job.id)}
                                                                    disabled={locatingJobId === job.id}
                                                                    className={iconActionButtonClass}
                                                                    title={locatingJobId === job.id ? 'Opening folder...' : 'Locate folder'}
                                                                    aria-label={locatingJobId === job.id ? 'Opening folder' : 'Locate folder'}
                                                                >
                                                                    {locatingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <FolderGlyph />}
                                                                </button>
                                                            </div>

                                                            <div className={`grid gap-2 pt-2 border-t border-[var(--border)] ${trimmedAssetId ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                                                {bgPair.originalAssetId && (
                                                                    <div className="rounded-md border border-[var(--border)] p-2 bg-[var(--panel-contrast)]">
                                                                        <div className="text-[10px] text-[var(--text-subtle)] mb-1">Original</div>
                                                                        <ImageWithAspectBadge
                                                                            src={api.getAssetUrl(job.id, bgPair.originalAssetId)}
                                                                            alt="Original"
                                                                            className="w-full h-16 object-contain rounded"
                                                                            wrapperClassName="w-full"
                                                                        />
                                                                        <a
                                                                            href={api.getAssetUrl(job.id, bgPair.originalAssetId)}
                                                                            download={`original_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={miniIconDownloadButtonClass}
                                                                            title="Download original"
                                                                            aria-label="Download original"
                                                                        >
                                                                            <DownloadIcon />
                                                                        </a>
                                                                    </div>
                                                                )}
                                                                <div className="rounded-md border border-[var(--border)] p-2 bg-[var(--panel-contrast)]">
                                                                    <div className="text-[10px] text-[var(--text-subtle)] mb-1">BG Removed</div>
                                                                    <ImageWithAspectBadge
                                                                        src={api.getAssetUrl(job.id, bgPair.bgRemovedAssetId)}
                                                                        alt="BG removed"
                                                                        className="w-full h-16 object-contain rounded"
                                                                        wrapperClassName="w-full"
                                                                    />
                                                                    <button
                                                                        onClick={(e) => handleTrimAlpha(e, job, bgPair.bgRemovedAssetId)}
                                                                        disabled={isTrimming}
                                                                        className={miniIconActionButtonClass}
                                                                        title={isTrimming ? 'Resizing image...' : 'Resize by trimming transparent (alpha) area'}
                                                                        aria-label={isTrimming ? 'Resizing image' : 'Resize image'}
                                                                    >
                                                                        {isTrimming ? <ReloadIcon className="animate-spin" /> : <CropIcon />}
                                                                    </button>
                                                                    <a
                                                                        href={api.getAssetUrl(job.id, bgPair.bgRemovedAssetId)}
                                                                        download={`bg_removed_${job.id.slice(0, 8)}.png`}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className={miniIconDownloadButtonClass}
                                                                        title="Download background removed image"
                                                                        aria-label="Download background removed image"
                                                                    >
                                                                        <DownloadIcon />
                                                                    </a>
                                                                </div>
                                                                {trimmedAssetId && (
                                                                    <div className="rounded-md border border-[var(--border)] p-2 bg-[var(--panel-contrast)]">
                                                                        <div className="text-[10px] text-[var(--text-subtle)] mb-1">Resized</div>
                                                                        <ImageWithAspectBadge
                                                                            src={api.getAssetUrl(job.id, trimmedAssetId)}
                                                                            alt="Resized"
                                                                            className="w-full h-16 object-contain rounded"
                                                                            wrapperClassName="w-full"
                                                                        />
                                                                        <a
                                                                            href={api.getAssetUrl(job.id, trimmedAssetId)}
                                                                            download={`resized_${job.id.slice(0, 8)}.png`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className={miniIconDownloadButtonClass}
                                                                            title="Download resized image"
                                                                            aria-label="Download resized image"
                                                                        >
                                                                            <DownloadIcon />
                                                                        </a>
                                                                    </div>
                                                                )}
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
                                onClick={() => setSegmentationCollapsed(!segmentationCollapsed)}
                                className="w-full flex items-center justify-between"
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Segmentation</div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm ${segmentationSummary.hasRunning ? 'bg-blue-500' : 'bg-green-500'
                                            }`}
                                        title={segmentationSummary.hasRunning ? 'Work in progress' : 'Done'}
                                    />
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/80 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm">
                                        {segmentationSummary.doneCount}
                                    </span>
                                    <span className="text-xs text-[var(--text-subtle)]">
                                        {segmentationCollapsed ? 'Show' : 'Hide'}
                                    </span>
                                </div>
                            </button>
                            {!segmentationCollapsed && (
                                <div className="space-y-2">
                                    {otherJobs.length === 0 && (
                                        <div className="text-xs text-[var(--text-subtle)]">No segmentation jobs yet.</div>
                                    )}
                                    {otherJobs.map((job) => {
                                        const imageUrl = getSourceImageUrl(job);
                                        const stepCount = job.steps?.length || 0;
                                        const completedSteps = job.steps?.filter(s => s.status === 'SUCCESS').length || 0;

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
                                                                className="w-full h-full object-contain"
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
                                                            <span className="text-xs font-mono text-[var(--text-subtle)]">
                                                                {job.id.slice(0, 8)}
                                                            </span>
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
                                                            <button
                                                                onClick={(e) => handleLocateFolder(e, job.id)}
                                                                disabled={locatingJobId === job.id}
                                                                className={iconActionButtonClass}
                                                                title={locatingJobId === job.id ? 'Opening folder...' : 'Locate folder'}
                                                                aria-label={locatingJobId === job.id ? 'Opening folder' : 'Locate folder'}
                                                            >
                                                                {locatingJobId === job.id ? <ReloadIcon className="animate-spin" /> : <FolderGlyph />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

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
