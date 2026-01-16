import { useEffect, useRef } from 'react';
import { Cross2Icon } from '@radix-ui/react-icons';

interface Log {
    message: string;
    level: string;
}

interface LogsPanelProps {
    logs: Log[];
    onClose?: () => void;
    className?: string;
}

export function LogsPanel({ logs, onClose, className = '' }: LogsPanelProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error':
                return 'text-[var(--danger)]';
            case 'warning':
                return 'text-[var(--warning)]';
            case 'success':
                return 'text-[var(--success)]';
            default:
                return 'text-[var(--text)]';
        }
    };

    const getLevelIcon = (level: string) => {
        switch (level) {
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️';
            case 'success':
                return '✅';
            default:
                return '📝';
        }
    };

    return (
        <div className={`flex h-full min-h-0 flex-col glass-panel border-t border-[var(--border)] ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-[var(--panel-muted)] border-b border-[var(--border)]">
                <span className="text-[10px] font-bold text-[var(--text-subtle)] uppercase tracking-wider">Execution Logs</span>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-[var(--panel-contrast)] rounded-md transition-colors text-[var(--text-subtle)] hover:text-[var(--text)]"
                        title="Close logs"
                    >
                        <Cross2Icon className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 font-mono text-xs">
                {logs.length === 0 ? (
                    <div className="text-[var(--text-subtle)] text-center py-8">
                        No logs yet. Logs will appear here as the job runs.
                    </div>
                ) : (
                    <div className="space-y-1">
                        {logs.map((log, index) => (
                            <div key={index} className={`${getLevelColor(log.level)}`}>
                                <span className="mr-2">{getLevelIcon(log.level)}</span>
                                {log.message}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
