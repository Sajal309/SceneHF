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

    return (
        <div className="max-w-4xl mx-auto p-8 space-y-6">
            {/* Upload Area */}
            <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${dragActive
                    ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]'
                    : preview
                        ? 'border-gray-700 bg-gray-900/50'
                        : 'border-gray-700 hover:border-gray-600 hover:bg-gray-900/30'
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
                            className="max-h-96 mx-auto rounded-lg shadow-2xl"
                        />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setPreview(null);
                                setUploadedFile(null);
                            }}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            Change image
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-7xl">🎨</div>
                        <div>
                            <p className="text-white text-xl font-semibold mb-2">
                                Drop your scene image here
                            </p>
                            <p className="text-gray-400">
                                or click to browse • PNG, JPG up to 10MB
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Layer Planning Section */}
            {preview && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Scene Description */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 space-y-3">
                        <label className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                            <LayersIcon className="w-4 h-4 text-indigo-400" />
                            Scene Description
                        </label>
                        <textarea
                            value={sceneDescription}
                            onChange={(e) => setSceneDescription(e.target.value)}
                            placeholder="Describe what's in this scene... (e.g., 'A fantasy cottage on a floating island with trees and grass')"
                            className="w-full h-24 bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                        />
                    </div>

                    {/* Layer Count Slider */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-gray-300">
                                Number of Layers
                            </label>
                            <span className="text-2xl font-bold text-indigo-400">
                                {layerCount}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="2"
                            max="10"
                            value={layerCount}
                            onChange={(e) => handleLayerCountChange(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <p className="text-xs text-gray-500">
                            Simple scenes: 2-4 layers • Complex scenes: 5-10 layers
                        </p>
                    </div>

                    {/* Layer Mapping Tree */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 space-y-4">
                        <label className="text-sm font-semibold text-gray-300">
                            Layer Map (Front to Back)
                        </label>
                        <div className="space-y-2">
                            {layers.map((layer) => (
                                <div
                                    key={layer.index}
                                    className="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
                                >
                                    <div className="flex items-center justify-center w-8 h-8 bg-indigo-500/20 text-indigo-400 rounded-lg font-bold text-sm">
                                        {layer.index}
                                    </div>
                                    <input
                                        type="text"
                                        value={layer.name}
                                        onChange={(e) => updateLayerName(layer.index, e.target.value)}
                                        placeholder={`Layer ${layer.index} name...`}
                                        className="flex-1 bg-transparent border-none outline-none text-sm text-gray-200 placeholder-gray-600"
                                    />
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500">
                            💡 Tip: Layer 1 is closest to camera, higher numbers are further back
                        </p>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleGeneratePlan}
                        disabled={uploading || !sceneDescription.trim()}
                        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white rounded-xl font-semibold text-lg transition-all disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                    >
                        {uploading ? 'Generating Plan...' : '✨ Generate Layer Plan'}
                    </button>
                </div>
            )}

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
                    {error}
                </div>
            )}
        </div>
    );
}
