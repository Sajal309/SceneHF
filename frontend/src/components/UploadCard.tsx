import { useState, useRef } from 'react';
import { PlusIcon, TrashIcon, LayersIcon } from '@radix-ui/react-icons';
import { useSettings, getApiHeaders } from '../context/SettingsContext';
import { api } from '../lib/api';

interface LayerSpec {
    index: number;
    name: string;
}

interface UploadCardProps {
    onJobCreated: (jobId: string) => void;
}

export function UploadCard({ onJobCreated }: UploadCardProps) {
    const { settings } = useSettings();
    const [dragActive, setDragActive] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<'segmentation' | 'reframe'>('segmentation');

    // Layer planning state
    const [layerCount, setLayerCount] = useState(4);
    const [layers, setLayers] = useState<LayerSpec[]>([
        { index: 1, name: 'Foreground elements' },
        { index: 2, name: 'Main subject' },
        { index: 3, name: 'Background' },
        { index: 4, name: 'Sky/distant elements' }
    ]);
    const [sceneDescription, setSceneDescription] = useState('');

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

    const handleGeneratePlan = async () => {
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

            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) imageConfig[key] = param.value;
            });

            // Trigger planning through standard helper
            await api.planJob(
                job_id,
                settings.provider,
                llmConfig,
                imageConfig,
                headers,
                sceneDescription,
                layerCount,
                layers
            );

            onJobCreated(job_id);
        } catch (err: any) {
            console.error('Handled generation error:', err);
            setError(err.message || 'Failed to generate plan');
        } finally {
            setUploading(false);
        }
    };

    const handleReframe = async () => {
        if (!uploadedFile) return;

        setUploading(true);
        setError(null);

        try {
            const { job_id } = await api.createJob(uploadedFile);
            const headers = getApiHeaders(settings);
            const imageConfig: Record<string, any> = {
                provider: settings.imageProvider,
                model: settings.imageModel
            };
            Object.entries(settings.imageParams).forEach(([key, param]) => {
                if (param.enabled) imageConfig[key] = param.value;
            });
            await api.reframeJob(job_id, imageConfig, headers);
            onJobCreated(job_id);
        } catch (err: any) {
            console.error('Reframe failed:', err);
            setError(err.message || 'Failed to reframe image');
        } finally {
            setUploading(false);
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
                        <img
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                                disabled={uploading}
                                className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-xl font-semibold text-base transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                            >
                                {uploading ? 'Reframing...' : 'Reframe Image'}
                            </button>
                        </div>
                    )}

                    {workflow === 'segmentation' && (
                        <>
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

                    {/* Generate Button */}
                    <button
                        onClick={handleGeneratePlan}
                        disabled={uploading || !sceneDescription.trim()}
                        className="w-full py-4 bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:bg-[var(--border)] disabled:text-[var(--text-subtle)] text-white rounded-xl font-semibold text-lg transition-all disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                    >
                        {uploading ? 'Generating Plan...' : '✨ Generate Layer Plan'}
                    </button>
                        </>
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
