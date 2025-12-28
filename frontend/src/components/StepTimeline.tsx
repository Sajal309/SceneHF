import { Step, StepStatus } from '../lib/api';

interface StepTimelineProps {
    steps: Step[];
    selectedStep: Step | null;
    onSelectStep: (step: Step) => void;
}

export function StepTimeline({ steps, selectedStep, onSelectStep }: StepTimelineProps) {
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
            default:
                return 'badge-queued';
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
