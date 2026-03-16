import React, { Suspense, lazy, useEffect, useState } from 'react';
import { SettingsProvider } from '../context/SettingsContext';

const SettingsPanel = lazy(async () => {
    const mod = await import('../components/sidebar/SettingsPanel');
    return { default: mod.SettingsPanel };
});

const HistoryPanel = lazy(async () => {
    const mod = await import('../components/sidebar/HistoryPanel');
    return { default: mod.HistoryPanel };
});

interface MainLayoutProps {
    children: React.ReactNode;
    onLoadJob: (jobId: string | null) => void;
    onPlanWithImage: (file: File) => void;
}

export function MainLayout({ children, onLoadJob, onPlanWithImage }: MainLayoutProps) {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [showSettingsPanel, setShowSettingsPanel] = useState(false);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);

    // Restore last job on mount
    useEffect(() => {
        const lastJobId = localStorage.getItem('scenehf_last_job');
        if (lastJobId) {
            handleLoadJob(lastJobId);
        }
    }, []);

    useEffect(() => {
        const rafId = window.requestAnimationFrame(() => {
            setShowSettingsPanel(true);
        });
        return () => window.cancelAnimationFrame(rafId);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setShowHistoryPanel(true);
        }, 900);
        return () => window.clearTimeout(timer);
    }, []);

    const handleLoadJob = (jobId: string | null) => {
        setCurrentJobId(jobId);
        onLoadJob(jobId);
    };

    const handlePlanWithImage = (file: File) => {
        setCurrentJobId(null);
        onLoadJob(null);
        onPlanWithImage(file);
    };

    return (
        <SettingsProvider>
            <div className="flex h-screen w-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans selection:bg-[var(--accent-soft)]">
                {/* Left Sidebar - Settings */}
                {showSettingsPanel ? (
                    <Suspense fallback={<aside className="w-80 h-full border-r border-[var(--border)] bg-[var(--panel-muted)]/60" />}>
                        <SettingsPanel />
                    </Suspense>
                ) : (
                    <aside className="w-80 h-full border-r border-[var(--border)] bg-[var(--panel-muted)]/60" />
                )}

                {/* Center - Workspace */}
                <main className="flex-1 h-full min-w-0 flex flex-col bg-[var(--bg)] relative">
                    {children}
                </main>

                {/* Right Sidebar - History */}
                {showHistoryPanel ? (
                    <Suspense fallback={<aside className="w-[420px] h-full border-l border-[var(--border)] bg-[var(--panel-muted)]/60" />}>
                        <HistoryPanel
                            currentJobId={currentJobId}
                            onLoadJob={handleLoadJob}
                            onGeneratePlanFromReframe={handlePlanWithImage}
                        />
                    </Suspense>
                ) : (
                    <aside className="w-[420px] h-full border-l border-[var(--border)] bg-[var(--panel-muted)]/60" />
                )}
            </div>
        </SettingsProvider>
    );
}
