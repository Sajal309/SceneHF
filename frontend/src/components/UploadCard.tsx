import { useState, useRef, useEffect } from 'react';
import { LayersIcon } from '@radix-ui/react-icons';
import { useSettings, getApiHeaders } from '../context/SettingsContext';
import { api } from '../lib/api';
import { ImageWithAspectBadge } from './common/ImageWithAspectBadge';

interface LayerSpec {
    index: number;
    name: string;
}

interface UploadCardProps {
    onJobCreated: (jobId: string | null) => void;
    initialFile?: File | null;
    onInitialFileUsed?: () => void;
}

export function UploadCard({ onJobCreated, initialFile, onInitialFileUsed }: UploadCardProps) {
    const { settings } = useSettings();
    const [dragActive, setDragActive] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<'segmentation' | 'reframe' | 'edit'>('segmentation');

    // Layer planning state
    const [layerCount, setLayerCount] = useState(4);
    const [layers, setLayers] = useState<LayerSpec[]>([
        { index: 1, name: 'Foreground elements' },
        { index: 2, name: 'Main subject' },
        { index: 3, name: 'Background' },
        { index: 4, name: 'Sky/distant elements' }
    ]);
    const [sceneDescription, setSceneDescription] = useState('');
    const [excludeCharactersInAuto, setExcludeCharactersInAuto] = useState(false);
    const [editPrompt, setEditPrompt] = useState('');
    const [removingCharacters, setRemovingCharacters] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const raw = e.dataTransfer.getData('application/x-scenehf-asset');
        if (raw) {
            try {
                const { jobId, assetId, filename } = JSON.parse(raw) as { jobId: string; assetId: string; filename?: string };
                const assetUrl = api.getAssetUrl(jobId, assetId);
                fetch(assetUrl)
                    .then((res) => {
                        if (!res.ok) throw new Error('Failed to load dragged image');
                        return res.blob();
                    })
                    .then((blob) => {
                        const extension = blob.type.split('/')[1] || 'png';
                        const name = filename || `${assetId}.${extension}`;
                        handleFile(new File([blob], name, { type: blob.type || 'image/png' }));
                    })
                    .catch((err) => {
                        console.error('Failed to load dragged asset:', err);
                        setError('Failed to load dragged image');
                    });
                return;
            } catch {
                // ignore and fall back to file drop
            }
        }

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }

        setError(null);
        setUploadedFile(file);

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
    };

    useEffect(() => {
        if (!initialFile) return;
        setError(null);
        setWorkflow('segmentation');
        handleFile(initialFile);
        onInitialFileUsed?.();
    }, [initialFile, onInitialFileUsed]);

    const handleClick = () => {
        inputRef.current?.click();
    };

    const handleLayerCountChange = (count: number) => {
        setLayerCount(count);

        // Adjust layers array
        if (count > layers.length) {
            const newLayers = [...layers];
            for (let i = layers.length; i < count; i++) {
                newLayers.push({ index: i + 1, name: `Layer ${i + 1}` });
            }
            setLayers(newLayers);
        } else {
            setLayers(layers.slice(0, count));
        }
    };

    const updateLayerName = (index: number, name: string) => {
        setLayers(layers.map(l => l.index === index ? { ...l, name } : l));
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

    const waitForStepSuccess = async (
        jobId: string,
        stepId: string,
        label: string,
        timeoutMs = 240000
    ) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const job = await api.getJob(jobId);
            const step = job.steps.find((s) => s.id === stepId);
            if (!step) {
                throw new Error(`${label} step not found`);
            }
            if (step.status === 'SUCCESS') {
                return step;
            }
            if (step.status === 'FAILED' || step.status === 'CANCELLED' || step.status === 'SKIPPED') {
                throw new Error(`${label} failed (${step.status})`);
            }
            await sleep(1200);
        }
        throw new Error(`${label} timed out`);
    };

    const assetToFile = async (jobId: string, assetId: string, baseName: string) => {
        const res = await fetch(api.getAssetUrl(jobId, assetId));
        if (!res.ok) {
            throw new Error('Failed to load processed image');
        }
        const blob = await res.blob();
        const extension = blob.type.split('/')[1] || 'png';
        return new File([blob], `${baseName}.${extension}`, { type: blob.type || 'image/png' });
    };

    const handleGeneratePlan = async (autoMode = false) => {
        if (!uploadedFile) return;

        setUploading(true);
        setError(null);

        try {
            // Upload image using standard helper
            const { job_id } = await api.createJob(uploadedFile);

            // Get headers and config from settings
            const headers = getApiHeaders(settings);

            const llmConfig: Record<string, any> = {
                model: settings.model
            };
            Object.entries(settings.llmParams).forEach(([key, param]) => {
                if (param.enabled) llmConfig[key] = param.value;
            });

            const imageConfig = getImageConfig();

            // Trigger planning through standard helper
            await api.planJob(
                job_id,
                settings.provider,
                llmConfig,
                imageConfig,
                headers,
                sceneDescription.trim() || undefined,
                autoMode ? undefined : layerCount,
                autoMode ? undefined : layers,
                autoMode ? excludeCharactersInAuto : undefined
            );

            onJobCreated(job_id);
        } catch (err: any) {
            console.error('Handled generation error:', err);
            setError(err.message || 'Failed to generate plan');
        } finally {
            setUploading(false);
        }
    };

    const handleAutoGeneratePlan = async () => {
        await handleGeneratePlan(true);
    };

    const handleReframe = async () => {
        if (!uploadedFile) return;

        setUploading(true);
        setError(null);

        try {
            const { job_id } = await api.createJob(uploadedFile);
            const headers = getApiHeaders(settings);
            const imageConfig = getImageConfig();
            await api.reframeJob(job_id, imageConfig, headers);
            onJobCreated(job_id);
        } catch (err: any) {
            console.error('Reframe failed:', err);
            setError(err.message || 'Failed to reframe image');
        } finally {
            setUploading(false);
        }
    };

    const handleEdit = async () => {
        if (!uploadedFile || !editPrompt.trim()) return;

        setUploading(true);
        setError(null);

        try {
            const { job_id } = await api.createJob(uploadedFile);
            const headers = getApiHeaders(settings);
            const imageConfig = getImageConfig();
            await api.editJob(job_id, editPrompt.trim(), imageConfig, headers);
            onJobCreated(job_id);
        } catch (err: any) {
            console.error('Edit failed:', err);
            setError(err.message || 'Failed to edit image');
        } finally {
            setUploading(false);
        }
    };

    const handleRemoveCharacter = async () => {
        if (!uploadedFile) return;

        setRemovingCharacters(true);
        setError(null);

        let reframeJobId: string | null = null;
        let removeJobId: string | null = null;

        try {
            const headers = getApiHeaders(settings);
            const imageConfig = getImageConfig();

            const reframeJob = await api.createJob(uploadedFile);
            reframeJobId = reframeJob.job_id;
            const reframeResult = await api.reframeJob(reframeJob.job_id, imageConfig, headers);
            const reframeStep = await waitForStepSuccess(reframeJob.job_id, reframeResult.step_id, 'Reframe');
            if (!reframeStep.output_asset_id) {
                throw new Error('Reframe did not return an output image');
            }

            const reframedFile = await assetToFile(
                reframeJob.job_id,
                reframeStep.output_asset_id,
                `reframed_${uploadedFile.name.replace(/\.[^/.]+$/, '')}`
            );

            const removeJob = await api.createJob(reframedFile);
            removeJobId = removeJob.job_id;
            const removeResult = await api.editJob(
                removeJob.job_id,
                'Remove all characters and people from this image.',
                imageConfig,
                headers
            );
            const removeStep = await waitForStepSuccess(removeJob.job_id, removeResult.step_id, 'Character removal');
            if (!removeStep.output_asset_id) {
                throw new Error('Character removal did not return an output image');
            }

            const cleanedFile = await assetToFile(
                removeJob.job_id,
                removeStep.output_asset_id,
                `character_removed_${uploadedFile.name.replace(/\.[^/.]+$/, '')}`
            );
            handleFile(cleanedFile);
        } catch (err: any) {
            console.error('Character removal failed:', err);
            setError(err.message || 'Failed to remove characters');
        } finally {
            setRemovingCharacters(false);
            if (reframeJobId) {
                api.deleteJob(reframeJobId).catch(() => undefined);
            }
            if (removeJobId) {
                api.deleteJob(removeJobId).catch(() => undefined);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-8 space-y-6">
            {/* Upload Area */}
            <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer backdrop-blur-xl ${dragActive
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] scale-[1.02]'
                    : preview
                        ? 'border-[var(--border-strong)] bg-[var(--panel)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-muted)]'
                    }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={!preview ? handleClick : undefined}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleChange}
                    className="hidden"
                />

                {preview ? (
                    <div className="space-y-4">
                        <ImageWithAspectBadge
                            src={preview}
                            alt="Preview"
                            className="max-h-96 mx-auto rounded-lg shadow-[var(--shadow-soft)]"
                        />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setPreview(null);
                                setUploadedFile(null);
                            }}
                            className="text-sm text-[var(--text-subtle)] hover:text-[var(--text)] transition-colors"
                        >
                            Change image
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-6xl">🎨</div>
                        <div>
                            <p className="text-[var(--text)] text-xl font-semibold mb-2">
                                Drop your scene image here
                            </p>
                            <p className="text-[var(--text-muted)]">
                                or click to browse • PNG, JPG up to 10MB
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Layer Planning Section */}
            {preview && (
                <div className="h-[60vh] overflow-y-scroll custom-scrollbar pr-2 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 glass-panel rounded-2xl p-4">
                    {/* Workflow Selection */}
                    <div className="glass-card rounded-xl p-6 space-y-4">
                        <div className="text-sm font-semibold text-[var(--text)]">Workflow</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <button
                                onClick={() => setWorkflow('reframe')}
                                className={`text-left p-4 rounded-xl border transition-all ${workflow === 'reframe'
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                    : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                    }`}
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Reframe</div>
                                <div className="text-xs text-[var(--text-subtle)] mt-1">
                                    Reframe the image to 16:9 using a simple prompt.
                                </div>
                            </button>
                            <button
                                onClick={() => setWorkflow('segmentation')}
                                className={`text-left p-4 rounded-xl border transition-all ${workflow === 'segmentation'
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                    : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                    }`}
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Segmentation</div>
                                <div className="text-xs text-[var(--text-subtle)] mt-1">
                                    Build a layer plan and extract scene elements.
                                </div>
                            </button>
                            <button
                                onClick={() => setWorkflow('edit')}
                                className={`text-left p-4 rounded-xl border transition-all ${workflow === 'edit'
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                    : 'border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)]'
                                    }`}
                            >
                                <div className="text-sm font-semibold text-[var(--text)]">Edit</div>
                                <div className="text-xs text-[var(--text-subtle)] mt-1">
                                    Upload an image and edit it with a prompt.
                                </div>
                            </button>
                        </div>
                    </div>

                    {workflow === 'reframe' && (
                        <div className="glass-card rounded-xl p-6 space-y-3">
                            <div className="text-sm font-semibold text-[var(--text)]">Reframe to 16:9</div>
                            <div className="text-xs text-[var(--text-subtle)]">
                                Prompt: “Reframe this image in 16:9.”
                            </div>
                            <button
                                onClick={handleReframe}
                                disabled={uploading || removingCharacters}
                                className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-xl font-semibold text-base transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                            >
                                {uploading ? 'Reframing...' : 'Reframe Image'}
                            </button>
                        </div>
                    )}

                    {workflow === 'segmentation' && (
                        <>
                    <div className="glass-card rounded-xl p-6 space-y-3">
                        <div className="text-sm font-semibold text-[var(--text)]">Preprocess</div>
                        <p className="text-xs text-[var(--text-subtle)]">
                            Reframe to 16:9, then remove all characters from the selected image.
                        </p>
                        <button
                            onClick={handleRemoveCharacter}
                            disabled={uploading || removingCharacters || !uploadedFile}
                            className="w-full py-3 bg-[var(--panel-contrast)] hover:bg-[var(--panel-muted)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-[var(--text)] rounded-xl font-semibold text-sm transition-all disabled:cursor-not-allowed border border-[var(--border-strong)]"
                        >
                            {removingCharacters ? 'Removing Characters...' : 'Remove Character'}
                        </button>
                    </div>
                    {/* Scene Description */}
                    <div className="glass-card rounded-xl p-6 space-y-3">
                        <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                            <LayersIcon className="w-4 h-4 text-[var(--accent)]" />
                            Scene Description
                        </label>
                        <textarea
                            value={sceneDescription}
                            onChange={(e) => setSceneDescription(e.target.value)}
                            placeholder="Describe what's in this scene... (e.g., 'A fantasy cottage on a floating island with trees and grass')"
                            className="w-full h-24 bg-[var(--panel-muted)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--text-subtle)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none resize-none"
                        />
                    </div>

                    {/* Layer Count Slider */}
                    <div className="glass-card rounded-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-[var(--text)]">
                                Number of Layers
                            </label>
                            <span className="text-2xl font-bold text-[var(--accent)]">
                                {layerCount}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="2"
                            max="10"
                            value={layerCount}
                            onChange={(e) => handleLayerCountChange(parseInt(e.target.value))}
                            className="w-full h-2 bg-[var(--panel-contrast)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                        />
                        <p className="text-xs text-[var(--text-subtle)]">
                            Simple scenes: 2-4 layers • Complex scenes: 5-10 layers
                        </p>
                    </div>

                    {/* Layer Mapping Tree */}
                    <div className="glass-card rounded-xl p-6 space-y-4">
                        <label className="text-sm font-semibold text-[var(--text)]">
                            Layer Map (Front to Back)
                        </label>
                        <div className="space-y-2">
                            {layers.map((layer) => (
                                <div
                                    key={layer.index}
                                    className="flex items-center gap-3 bg-[var(--panel-muted)] border border-[var(--border)] rounded-lg p-3 hover:border-[var(--border-strong)] transition-colors"
                                >
                                    <div className="flex items-center justify-center w-8 h-8 bg-[var(--accent-soft)] text-[var(--accent-strong)] rounded-lg font-bold text-sm">
                                        {layer.index}
                                    </div>
                                    <input
                                        type="text"
                                        value={layer.name}
                                        onChange={(e) => updateLayerName(layer.index, e.target.value)}
                                        placeholder={`Layer ${layer.index} name...`}
                                        className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text)] placeholder-[var(--text-subtle)]"
                                    />
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-[var(--text-subtle)]">
                            💡 Tip: Layer 1 is closest to camera, higher numbers are further back
                        </p>
                    </div>

                    {/* Generate Buttons */}
                    <div className="glass-card rounded-xl p-4 space-y-2">
                        <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
                            <span className="font-semibold">Auto: Exclude Characters</span>
                            <input
                                type="checkbox"
                                checked={excludeCharactersInAuto}
                                onChange={(e) => setExcludeCharactersInAuto(e.target.checked)}
                                className="w-4 h-4 accent-[var(--accent)]"
                            />
                        </label>
                        <p className="text-xs text-[var(--text-subtle)]">
                            When enabled, Auto plan ignores people/characters and plans only environment layers.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <button
                            onClick={handleAutoGeneratePlan}
                            disabled={uploading || removingCharacters}
                            className="w-full py-4 bg-[var(--panel-contrast)] hover:bg-[var(--panel-muted)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-[var(--text)] rounded-xl font-semibold text-lg transition-all disabled:cursor-not-allowed border border-[var(--border-strong)]"
                        >
                            {uploading ? 'Generating Plan...' : 'Auto'}
                        </button>
                        <button
                            onClick={() => handleGeneratePlan(false)}
                            disabled={uploading || removingCharacters || !sceneDescription.trim()}
                            className="w-full py-4 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-xl font-semibold text-lg transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                        >
                            {uploading ? 'Generating Plan...' : '✨ Generate Layer Plan'}
                        </button>
                    </div>
                    <p className="text-xs text-[var(--text-subtle)]">
                        Auto lets the agent decide layer count, layer prompts, and scene summary from the uploaded image.
                    </p>
                        </>
                    )}

                    {workflow === 'edit' && (
                        <div className="glass-card rounded-xl p-6 space-y-4">
                            <div className="text-sm font-semibold text-[var(--text)]">Prompted Edit</div>
                            <textarea
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="Describe the edit you want (e.g., 'Change the sky to a pink sunset')"
                                className="w-full h-28 bg-[var(--panel-muted)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--text-subtle)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none resize-none"
                            />
                            <button
                                onClick={handleEdit}
                                disabled={uploading || removingCharacters || !editPrompt.trim()}
                                className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-xl font-semibold text-base transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                            >
                                {uploading ? 'Generating...' : 'Generate Edit'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-[var(--danger)] text-sm">
                    {error}
                </div>
            )}
        </div>
    );
}
