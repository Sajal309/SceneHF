import { useEffect, useRef } from 'react';

interface Log {
    message: string;
    level: string;
}

interface LogsPanelProps {
    logs: Log[];
    className?: string;
}

export function LogsPanel({ logs, className = '' }: LogsPanelProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error':
                return 'text-red-400';
            case 'warning':
                return 'text-yellow-400';
            case 'success':
                return 'text-green-400';
            default:
                return 'text-slate-300';
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
        <div className={`flex-1 overflow-y-auto bg-slate-900 rounded-lg p-4 font-mono text-xs ${className}`}>
            {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-8">
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
    );
}
