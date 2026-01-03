import { Job as JobType, Step, StepStatus, api } from '../../lib/api';
import { ReloadIcon, DownloadIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons';

interface StepListProps {
    job: JobType;
    selectedStep: Step | null;
    onSelectStep: (step: Step) => void;
    onRerunStep: (stepId: string) => void;
    onStopStep: (stepId: string) => void;
}

export function StepList({ job, selectedStep, onSelectStep, onRerunStep, onStopStep }: StepListProps) {
    const getStatusColor = (status: StepStatus) => {
        switch (status) {
            case StepStatus.SUCCESS:
                return 'bg-green-500/20 text-green-400 border-green-500/30';
            case StepStatus.RUNNING:
                return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case StepStatus.FAILED:
                return 'bg-red-500/20 text-red-400 border-red-500/30';
            case StepStatus.QUEUED:
                return 'bg-gray-700/50 text-gray-400 border-gray-600/30';
            case StepStatus.CANCELLED:
                return 'bg-gray-800/50 text-gray-500 border-gray-700/30';
            default:
                return 'bg-gray-700/50 text-gray-400 border-gray-600/30';
        }
    };

    const handleDownload = async (step: Step) => {
        if (!step.output_asset_id) return;

        try {
            const url = api.getAssetUrl(job.id, step.output_asset_id);
            const response = await fetch(url);
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', `${step.name.replace(/\s+/g, '_').toLowerCase()}.png`);
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Download failed:', error);
        }
    };

    return (
        <div className="w-96 bg-gray-900 border-l border-gray-800 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300">Generation Steps</h2>
                <p className="text-xs text-gray-500 mt-1">
                    {job.steps.length} steps • Click to edit
                </p>
            </div>

            {/* Step List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {job.steps.length === 0 ? (
                    <div className="text-center py-12 text-gray-600 text-sm">
                        No steps yet. Generate a plan first.
                    </div>
                ) : (
                    job.steps.map((step, index) => {
                        const isSelected = selectedStep?.id === step.id;
                        const imageUrl = step.output_asset_id
                            ? api.getAssetUrl(job.id, step.output_asset_id)
                            : step.input_asset_id
                                ? api.getAssetUrl(job.id, step.input_asset_id)
                                : null;

                        return (
                            <div
                                key={step.id}
                                onClick={() => onSelectStep(step)}
                                className={`rounded-lg border overflow-hidden cursor-pointer transition-all ${isSelected
                                        ? 'border-indigo-500 bg-indigo-500/10 shadow-lg'
                                        : 'border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-800/50'
                                    }`}
                            >
                                {/* Thumbnail */}
                                <div className="aspect-video w-full bg-gray-950 overflow-hidden relative">
                                    {imageUrl ? (
                                        <img src={imageUrl} alt={step.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">
                                            No Preview
                                        </div>
                                    )}
                                    {(step.status === 'RUNNING' || step.status === 'QUEUED') && (
                                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                            <div className="w-8 h-8 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                                        </div>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-mono text-gray-500">#{index + 1}</span>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(step.status)}`}>
                                                    {step.status}
                                                </span>
                                            </div>
                                            <div className="text-sm font-medium text-gray-200 truncate">
                                                {step.name}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                                                {step.custom_prompt || step.prompt}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 pt-2 border-t border-gray-800/50">
                                        {(step.status === 'RUNNING' || step.status === 'QUEUED') ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onStopStep(step.id);
                                                }}
                                                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                            >
                                                <Cross2Icon className="w-3 h-3" />
                                                Stop
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onRerunStep(step.id);
                                                    }}
                                                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 rounded transition-colors"
                                                >
                                                    <ReloadIcon className="w-3 h-3" />
                                                    Rerun
                                                </button>
                                                {step.output_asset_id && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownload(step);
                                                        }}
                                                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-colors"
                                                    >
                                                        <DownloadIcon className="w-3 h-3" />
                                                        Save
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {step.validation && (
                                        <div className="text-[10px] text-gray-600 pt-1">
                                            {step.validation.notes}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
