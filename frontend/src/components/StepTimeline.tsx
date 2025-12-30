import { Step, StepStatus, api } from '../lib/api';
import { Cross2Icon } from '@radix-ui/react-icons';

interface StepTimelineProps {
    jobId: string;
    steps: Step[];
    selectedStep: Step | null;
    onSelectStep: (step: Step) => void;
}

export function StepTimeline({ jobId, steps, selectedStep, onSelectStep }: StepTimelineProps) {
    const getStatusBadgeClass = (status: StepStatus) => {
        switch (status) {
            case StepStatus.QUEUED:
                return 'badge-queued';
            case StepStatus.RUNNING:
                return 'badge-running';
            case StepStatus.SUCCESS:
                return 'badge-success';
            case StepStatus.NEEDS_REVIEW:
                return 'badge-needs-review';
            case StepStatus.FAILED:
                return 'badge-failed';
            case StepStatus.CANCELLED:
                return 'bg-slate-700 text-slate-400';
            default:
                return 'badge-queued';
        }
    };

    const handleStop = async (e: React.MouseEvent, stepId: string) => {
        e.stopPropagation();
        if (confirm("Are you sure you want to stop this generation?")) {
            try {
                await api.stopStep(jobId, stepId);
            } catch (err) {
                console.error("Failed to stop step:", err);
            }
        }
    };

    if (steps.length === 0) {
        return (
            <div className="text-slate-400 text-sm text-center py-8">
                No steps yet. Click "Plan" to generate steps.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {steps.map((step, index) => (
                <div
                    key={step.id}
                    onClick={() => onSelectStep(step)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${selectedStep?.id === step.id
                        ? 'bg-primary-600/20 border border-primary-500'
                        : 'bg-slate-700/50 hover:bg-slate-700 border border-transparent'
                        }`}
                >
                    <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-xs font-mono">
                                #{index + 1}
                            </span>
                            <span className={`badge ${getStatusBadgeClass(step.status)}`}>
                                {step.status}
                            </span>
                        </div>

                        {(step.status === StepStatus.RUNNING || step.status === StepStatus.QUEUED) && (
                            <button
                                onClick={(e) => handleStop(e, step.id)}
                                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                title="Stop Generation"
                            >
                                <Cross2Icon className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    <div className="text-white text-sm font-medium mb-1">
                        {step.name}
                    </div>

                    <div className="text-slate-400 text-xs">
                        {step.type}
                    </div>

                    {step.validation && (
                        <div className="mt-2 text-xs text-slate-400">
                            {step.validation.notes}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
