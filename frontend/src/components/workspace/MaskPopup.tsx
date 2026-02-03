import { useEffect, useRef, useState } from 'react';
import { Job, Step, api } from '../../lib/api';
import { Cross2Icon, Pencil2Icon, EraserIcon, UploadIcon } from '@radix-ui/react-icons';
import { ImageWithAspectBadge } from '../common/ImageWithAspectBadge';

interface MaskPopupProps {
    job: Job;
    step: Step;
    onClose: () => void;
}

type Tool = 'brush' | 'eraser';

export function MaskPopup({ job, step, onClose }: MaskPopupProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [maskIntent, setMaskIntent] = useState(step.mask_intent || 'INPAINT_REMOVE');
    const [tool, setTool] = useState<Tool>('brush');
    const [brushSize, setBrushSize] = useState(32);
    const [isDrawing, setIsDrawing] = useState(false);
    const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const [maskPrompt, setMaskPrompt] = useState(step.mask_prompt || '');
    const [intentStatus, setIntentStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [maskStatus, setMaskStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const inputAssetId = step.input_asset_id || job.source_image;
    const inputUrl = inputAssetId ? api.getAssetUrl(job.id, inputAssetId) : null;
    const maskUrl = step.mask_asset_id ? api.getAssetUrl(job.id, step.mask_asset_id) : null;

    useEffect(() => {
        setMaskIntent(step.mask_intent || 'INPAINT_REMOVE');
        setMaskPrompt(step.mask_prompt || '');
        setMaskStatus(step.mask_asset_id ? 'saved' : 'idle');
    }, [step.mask_intent, step.mask_prompt, step.mask_asset_id]);

    useEffect(() => {
        if (!inputUrl || !canvasRef.current) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (maskUrl) {
                const maskImg = new Image();
                maskImg.crossOrigin = 'anonymous';
                maskImg.onload = () => {
                    ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
                };
                maskImg.src = maskUrl;
            }
        };
        img.src = inputUrl;
    }, [inputUrl, maskUrl]);

    const pointerToCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        return { x, y };
    };

    const drawLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = tool === 'brush' ? 'white' : 'black';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const point = pointerToCanvas(e);
        if (!point) return;
        setIsDrawing(true);
        setLastPoint(point);
        drawLine(point, point);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        if (!isDrawing || !lastPoint) return;
        const point = pointerToCanvas(e);
        if (!point) return;
        drawLine(lastPoint, point);
        setLastPoint(point);
    };

    const endDrawing = () => {
        setIsDrawing(false);
        setLastPoint(null);
    };

    const handleClear = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const handleSaveMask = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setSaving(true);
        setMaskStatus('saving');
        try {
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Failed to export mask');
            const file = new File([blob], `mask_${step.id}.png`, { type: 'image/png' });
            const uploaded = await api.uploadMask(job.id, file);
            await api.patchStep(job.id, step.id, {
                mask_mode: 'MANUAL',
                mask_asset_id: uploaded.asset_id,
                mask_intent: maskIntent,
                mask_prompt: maskPrompt || null
            });
            setMaskStatus('saved');
            onClose();
        } catch (err) {
            console.error('Save mask failed:', err);
            alert('Failed to save mask');
            setMaskStatus('error');
        } finally {
            setSaving(false);
        }
    };

    const handleUploadMask = async (file: File) => {
        setMaskStatus('saving');
        try {
            const uploaded = await api.uploadMask(job.id, file);
            await api.patchStep(job.id, step.id, {
                mask_mode: 'MANUAL',
                mask_asset_id: uploaded.asset_id,
                mask_intent: maskIntent,
                mask_prompt: maskPrompt || null
            });
            setMaskStatus('saved');
            onClose();
        } catch (err) {
            console.error('Upload mask failed:', err);
            alert('Failed to upload mask');
            setMaskStatus('error');
        }
    };

    const handleIntentChange = async (intent: string) => {
        setMaskIntent(intent);
        try {
            await api.patchStep(job.id, step.id, {
                mask_intent: intent,
                mask_prompt: maskPrompt || null
            });
        } catch (err) {
            console.error('Mask intent update failed:', err);
        }
    };

    const handleSavePrompt = async () => {
        setIntentStatus('saving');
        try {
            await api.patchStep(job.id, step.id, {
                mask_prompt: maskPrompt || null
            });
            setIntentStatus('saved');
            window.setTimeout(() => setIntentStatus('idle'), 1200);
        } catch (err) {
            console.error('Mask prompt update failed:', err);
            setIntentStatus('error');
            window.setTimeout(() => setIntentStatus('idle'), 1600);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/10 backdrop-blur-sm">
            <div className="w-full h-full glass-card rounded-none border border-[var(--border-strong)] shadow-[var(--shadow-soft)] overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                    <div>
                        <div className="text-xs uppercase tracking-wider text-[var(--text-subtle)] font-bold">Mask Editor</div>
                        <div className="text-sm font-semibold text-[var(--text)]">{step.name}</div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--panel-contrast)]"
                    >
                        <Cross2Icon />
                    </button>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 overflow-auto h-[calc(100vh-72px)]">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Draw Mask</div>
                            <div className="text-xs text-[var(--text-subtle)]">
                                Paint the region you want to edit. White = edit, black = keep.
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Mask Intent</div>
                            <select
                                value={maskIntent || 'INPAINT_REMOVE'}
                                onChange={(e) => handleIntentChange(e.target.value)}
                                className="w-full bg-[var(--panel-contrast)] border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-[var(--text)]"
                            >
                                <option value="INPAINT_REMOVE">Inpaint Remove</option>
                                <option value="INPAINT_INSERT">Inpaint Insert</option>
                                <option value="EXTRACT_HELPER">Extract Helper</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Manual Mask</div>
                            <div className="flex gap-2">
                                <div className="flex-1 text-xs px-2 py-1.5 rounded-md border bg-[var(--accent-soft)] text-[var(--accent-strong)] border-[var(--accent)] text-center">
                                    Draw
                                </div>
                                <label className="flex-1">
                                    <input
                                        type="file"
                                        accept="image/png"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleUploadMask(file);
                                        }}
                                    />
                                    <span className="flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)] cursor-pointer">
                                        <UploadIcon />
                                        Upload
                                    </span>
                                </label>
                            </div>
                            {maskStatus === 'saved' && (
                                <div className="text-[11px] text-[var(--success)]">Mask ready.</div>
                            )}
                            {maskStatus === 'error' && (
                                <div className="text-[11px] text-[var(--danger)]">Mask save failed.</div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Brush</div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setTool('brush')}
                                    className={`flex-1 text-xs px-2 py-1.5 rounded-md border ${tool === 'brush'
                                        ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)] border-[var(--accent)]'
                                        : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)]'
                                        }`}
                                >
                                    <Pencil2Icon className="inline-block mr-1" />
                                    Brush
                                </button>
                                <button
                                    onClick={() => setTool('eraser')}
                                    className={`flex-1 text-xs px-2 py-1.5 rounded-md border ${tool === 'eraser'
                                        ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)] border-[var(--accent)]'
                                        : 'bg-[var(--panel-contrast)] text-[var(--text-subtle)] border-[var(--border)]'
                                        }`}
                                >
                                    <EraserIcon className="inline-block mr-1" />
                                    Erase
                                </button>
                            </div>
                            <input
                                type="range"
                                min={8}
                                max={120}
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-full"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleClear}
                                className="flex-1 text-xs px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text-subtle)]"
                            >
                                Clear
                            </button>
                            <button
                                onClick={handleSaveMask}
                                disabled={saving}
                                className="flex-1 text-xs px-3 py-2 rounded-md border border-[var(--accent)] bg-[var(--accent)] text-white disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : 'Save Mask'}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="text-xs text-[var(--text-subtle)]">
                            Paint white to edit. Black stays untouched. Mask must match the input image size.
                        </div>
                        <div className="relative w-full flex-1 min-h-[60vh] bg-[var(--panel-contrast)] rounded-xl overflow-hidden border border-[var(--border)] flex items-center justify-center">
                            {inputUrl ? (
                                <div className="relative">
                                    <ImageWithAspectBadge
                                        src={inputUrl}
                                        alt="Input"
                                        className="block max-h-[70vh] max-w-full w-auto h-auto"
                                        wrapperClassName="inline-block"
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        className="absolute inset-0 w-full h-full opacity-70 z-10 cursor-crosshair touch-none"
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                            handlePointerDown(e);
                                        }}
                                        onPointerMove={handlePointerMove}
                                        onPointerUp={(e) => {
                                            e.preventDefault();
                                            e.currentTarget.releasePointerCapture(e.pointerId);
                                            endDrawing();
                                        }}
                                        onPointerLeave={endDrawing}
                                        onPointerCancel={(e) => {
                                            e.preventDefault();
                                            endDrawing();
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="p-6 text-sm text-[var(--text-subtle)]">No input image available.</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-[var(--text-subtle)]">Intent Prompt</div>
                            <textarea
                                value={maskPrompt}
                                onChange={(e) => setMaskPrompt(e.target.value)}
                                placeholder="Describe what should change inside the mask..."
                                className="w-full min-h-[90px] bg-[var(--panel-contrast)] border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                            />
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] text-[var(--text-subtle)]">
                                    This intent is added to the mask edit prompt.
                                </div>
                                <button
                                    onClick={handleSavePrompt}
                                    className="text-xs px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--panel-contrast)] text-[var(--text-subtle)] hover:text-[var(--text)]"
                                >
                                    {intentStatus === 'saving' ? 'Saving...' : intentStatus === 'saved' ? 'Saved' : 'Save Intent'}
                                </button>
                            </div>
                            {intentStatus === 'error' && (
                                <div className="text-[11px] text-[var(--danger)]">Intent save failed.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
