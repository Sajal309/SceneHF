import { useState } from 'react';
import { Step, StepStatus, api } from '../lib/api';

interface StepActionsProps {
    jobId: string;
    step: Step;
}

export function StepActions({ jobId, step }: StepActionsProps) {
    const [showRetryModal, setShowRetryModal] = useState(false);
    const [showPlateModal, setShowPlateModal] = useState(false);
    const [retryPrompt, setRetryPrompt] = useState('');
    const [removePrompt, setRemovePrompt] = useState('');
    const [plateRetryPrompt, setPlateRetryPrompt] = useState('');
    const [loading, setLoading] = useState(false);

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

    const handleRetry = async () => {
        if (!retryPrompt.trim()) return;

        setLoading(true);
        try {
            await api.retryStep(jobId, step.id, retryPrompt);
            setShowRetryModal(false);
            setRetryPrompt('');
        } catch (err) {
            console.error('Retry failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handlePlateAndRetry = async () => {
        if (!removePrompt.trim() || !plateRetryPrompt.trim()) return;

        setLoading(true);
        try {
            await api.plateAndRetry(jobId, step.id, removePrompt, plateRetryPrompt);
            setShowPlateModal(false);
            setRemovePrompt('');
            setPlateRetryPrompt('');
        } catch (err) {
            console.error('Plate and retry failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const canShowActions = [StepStatus.SUCCESS, StepStatus.NEEDS_REVIEW, StepStatus.FAILED].includes(step.status);

    if (!canShowActions) {
        return (
            <div className="text-slate-400 text-sm">
                No actions available for this step yet.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Accept */}
            {step.status !== StepStatus.FAILED && (
                <button
                    onClick={handleAccept}
                    disabled={loading}
                    className="btn btn-success w-full"
                >
                    ✅ Accept
                </button>
            )}

            {/* BG Remove */}
            {step.output_asset_id && (
                <button
                    onClick={handleBgRemove}
                    disabled={loading}
                    className="btn btn-secondary w-full"
                >
                    🪄 Remove Background (Fal.ai)
                </button>
            )}

            {/* Retry */}
            <button
                onClick={() => setShowRetryModal(true)}
                disabled={loading}
                className="btn btn-warning w-full"
            >
                🔁 Retry with Custom Prompt
            </button>

            {/* Plate + Retry */}
            <button
                onClick={() => setShowPlateModal(true)}
                disabled={loading}
                className="btn btn-danger w-full"
            >
                🧹 Create Plate then Retry
            </button>

            {/* Retry Modal */}
            {showRetryModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-lg p-6 max-w-lg w-full mx-4">
                        <h3 className="text-white text-lg font-semibold mb-4">
                            Retry with Custom Prompt
                        </h3>
                        <textarea
                            value={retryPrompt}
                            onChange={(e) => setRetryPrompt(e.target.value)}
                            placeholder="Enter custom prompt..."
                            className="input w-full h-32 resize-none mb-4"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleRetry}
                                disabled={loading || !retryPrompt.trim()}
                                className="btn btn-primary flex-1"
                            >
                                {loading ? 'Retrying...' : 'Retry'}
                            </button>
                            <button
                                onClick={() => setShowRetryModal(false)}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Plate Modal */}
            {showPlateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-lg p-6 max-w-lg w-full mx-4">
                        <h3 className="text-white text-lg font-semibold mb-4">
                            Create Plate then Retry
                        </h3>

                        <label className="block text-slate-300 text-sm mb-2">
                            1. Remove Prompt (create plate):
                        </label>
                        <textarea
                            value={removePrompt}
                            onChange={(e) => setRemovePrompt(e.target.value)}
                            placeholder="Remove occluders from image..."
                            className="input w-full h-24 resize-none mb-4"
                        />

                        <label className="block text-slate-300 text-sm mb-2">
                            2. Retry Prompt (extract from plate):
                        </label>
                        <textarea
                            value={plateRetryPrompt}
                            onChange={(e) => setPlateRetryPrompt(e.target.value)}
                            placeholder="Extract layer on white background..."
                            className="input w-full h-24 resize-none mb-4"
                        />

                        <div className="flex gap-2">
                            <button
                                onClick={handlePlateAndRetry}
                                disabled={loading || !removePrompt.trim() || !plateRetryPrompt.trim()}
                                className="btn btn-primary flex-1"
                            >
                                {loading ? 'Processing...' : 'Create & Retry'}
                            </button>
                            <button
                                onClick={() => setShowPlateModal(false)}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
