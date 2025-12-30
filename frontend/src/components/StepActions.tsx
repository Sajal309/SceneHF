import { useState, useEffect, useMemo } from 'react';
import { Step, StepStatus, api } from '../lib/api';
import { GearIcon, UpdateIcon, Cross2Icon, PlusIcon, TrashIcon, CodeIcon, CopyIcon, RocketIcon } from '@radix-ui/react-icons';

interface StepActionsProps {
    jobId: string;
    step: Step;
}

export function StepActions({ jobId, step }: StepActionsProps) {
    const [showEdit, setShowEdit] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [previewMode, setPreviewMode] = useState<'json' | 'curl'>('json');
    const [prompt, setPrompt] = useState(step.custom_prompt || step.prompt);
    const [config, setConfig] = useState<Record<string, any>>(step.image_config || {});
    const [editedJson, setEditedJson] = useState('');
    const [loading, setLoading] = useState(false);

    // Sync with step if it changes
    useEffect(() => {
        setPrompt(step.custom_prompt || step.prompt);
        if (step.image_config) {
            setConfig(step.image_config);
        }
    }, [step]);

    // Auto-switch provider based on model name
    useEffect(() => {
        const model = config.model?.toLowerCase() || '';
        if (model.includes('gemini') && config.provider !== 'google') {
            updateConfig('provider', 'google');
        } else if ((model.includes('gpt') || model.includes('dall-e')) && config.provider !== 'openai') {
            updateConfig('provider', 'openai');
        }
    }, [config.model]);

    // Calculate payload and curl
    const payload = useMemo(() => ({
        custom_prompt: prompt,
        image_config: config
    }), [prompt, config]);

    const curlCommand = useMemo(() => {
        return `curl -X POST http://localhost:8000/api/jobs/${jobId}/steps/${step.id}/retry \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
    }, [jobId, step.id, payload]);

    // Update editedJson when payload changes, but only if not currently editing? 
    // Actually, let's just update it whenever showPreview is toggled or payload changes if it matches previous.
    useEffect(() => {
        setEditedJson(JSON.stringify(payload, null, 2));
    }, [payload]);

    const handleAccept = async () => {
        setLoading(true);
        try {
            await api.acceptStep(jobId, step.id);
        } catch (err) {
            console.error('Accept failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleBgRemove = async () => {
        setLoading(true);
        try {
            await api.bgRemoveStep(jobId, step.id);
        } catch (err) {
            console.error('BG remove failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRerun = async () => {
        setLoading(true);
        try {
            await api.retryStep(jobId, step.id, prompt, config);
            setShowEdit(false);
        } catch (err) {
            console.error('Rerun failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDirectExecute = async () => {
        setLoading(true);
        try {
            const parsed = JSON.parse(editedJson);
            await api.retryStep(jobId, step.id, parsed.custom_prompt, parsed.image_config);
            setShowEdit(false);
            setShowPreview(false);
        } catch (err) {
            console.error('Direct execute failed:', err);
            alert("Invalid JSON payload");
        } finally {
            setLoading(false);
        }
    };

    const updateConfig = (key: string, value: any) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const removeParam = (key: string) => {
        const next = { ...config };
        delete next[key];
        setConfig(next);
    };

    const canShowActions = [StepStatus.SUCCESS, StepStatus.NEEDS_REVIEW, StepStatus.FAILED].includes(step.status);

    if (!canShowActions) {
        return (
            <div className="text-slate-500 text-xs italic">
                Awaiting completion...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {!showEdit ? (
                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        <button
                            onClick={handleAccept}
                            disabled={loading}
                            className="flex-1 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 border border-emerald-600/30"
                        >
                            Accept
                        </button>
                        <button
                            onClick={() => setShowEdit(true)}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 border border-slate-600"
                        >
                            <GearIcon />
                            Edit & Rerun
                        </button>
                    </div>
                    {step.output_asset_id && (
                        <button
                            onClick={handleBgRemove}
                            disabled={loading}
                            className="w-full px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 border border-indigo-600/30"
                        >
                            Magic BG Removal
                        </button>
                    )}
                </div>
            ) : (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <GearIcon />
                            Step Configuration
                        </h4>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className={`p-1 rounded transition-colors ${showPreview ? 'text-blue-400 bg-blue-400/10' : 'text-slate-500 hover:text-slate-300'}`}
                                title="Show Request Preview"
                            >
                                <CodeIcon />
                            </button>
                            <button
                                onClick={() => setShowEdit(false)}
                                className="text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                <Cross2Icon />
                            </button>
                        </div>
                    </div>

                    {!showPreview ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Prompt Override</label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 min-h-[80px] resize-none"
                                    placeholder="Custom extraction prompt..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Provider</label>
                                    <select
                                        value={config.provider || 'vertex'}
                                        onChange={(e) => updateConfig('provider', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-slate-200 focus:outline-none"
                                    >
                                        <option value="vertex">Vertex (Imagen)</option>
                                        <option value="openai">OpenAI (DALL-E)</option>
                                        <option value="google">Google (Gemini)</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
                                    <input
                                        type="text"
                                        value={config.model || ''}
                                        onChange={(e) => updateConfig('model', e.target.value)}
                                        placeholder="Auto"
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-slate-200 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Parameters</label>
                                    <button
                                        onClick={() => updateConfig(`param_${Date.now()}`, '')}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-bold"
                                    >
                                        <PlusIcon /> Add
                                    </button>
                                </div>
                                <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1">
                                    {Object.entries(config)
                                        .filter(([k]) => k !== 'provider' && k !== 'model')
                                        .map(([k, v]) => (
                                            <div key={k} className="flex gap-1 group">
                                                <input
                                                    type="text"
                                                    value={k}
                                                    readOnly
                                                    className="flex-1 bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-slate-400 focus:outline-none"
                                                />
                                                <input
                                                    type="text"
                                                    value={String(v)}
                                                    onChange={(e) => updateConfig(k, e.target.value)}
                                                    className="flex-1 bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
                                                />
                                                <button
                                                    onClick={() => removeParam(k)}
                                                    className="p-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <TrashIcon />
                                                </button>
                                            </div>
                                        ))}
                                    {Object.entries(config).filter(([k]) => k !== 'provider' && k !== 'model').length === 0 && (
                                        <div className="text-[10px] text-slate-600 italic">No custom params</div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex items-center justify-between bg-slate-900 p-1 rounded-t border border-slate-700 border-b-0">
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => setPreviewMode('json')}
                                        className={`px-2 py-0.5 text-[10px] font-bold rounded ${previewMode === 'json' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        JSON
                                    </button>
                                    <button
                                        onClick={() => setPreviewMode('curl')}
                                        className={`px-2 py-0.5 text-[10px] font-bold rounded ${previewMode === 'curl' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        CURL
                                    </button>
                                </div>
                                <button
                                    onClick={() => navigator.clipboard.writeText(previewMode === 'json' ? editedJson : curlCommand)}
                                    className="p-1 text-slate-500 hover:text-slate-300"
                                    title="Copy to clipboard"
                                >
                                    <CopyIcon />
                                </button>
                            </div>
                            <textarea
                                value={previewMode === 'json' ? editedJson : curlCommand}
                                onChange={(e) => previewMode === 'json' && setEditedJson(e.target.value)}
                                readOnly={previewMode === 'curl'}
                                className="w-full bg-slate-900 border border-slate-700 border-t-0 rounded-b p-2 text-[11px] font-mono text-blue-300 focus:outline-none focus:border-blue-500 min-h-[200px] resize-none whitespace-pre overflow-x-auto"
                            />
                            <div className="text-[10px] text-slate-500 flex items-center gap-2">
                                <UpdateIcon className="w-3 h-3" />
                                {previewMode === 'json' ? 'Edit JSON above to override the entire request' : 'Read-only CURL preview'}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t border-slate-700">
                        {showPreview ? (
                            <button
                                onClick={handleDirectExecute}
                                disabled={loading}
                                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-emerald-900/20"
                            >
                                {loading ? <UpdateIcon className="animate-spin" /> : <RocketIcon className="w-4 h-4" />}
                                Execute Request
                            </button>
                        ) : (
                            <button
                                onClick={handleRerun}
                                disabled={loading}
                                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-blue-900/20"
                            >
                                {loading ? <UpdateIcon className="animate-spin" /> : <UpdateIcon />}
                                Rerun Generation
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setShowEdit(false);
                                setShowPreview(false);
                            }}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}


