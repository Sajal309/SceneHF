import React, { Suspense, lazy, useEffect, useState } from 'react';

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
    storageSessionKey: string;
}

export function MainLayout({ children, onLoadJob, onPlanWithImage, storageSessionKey }: MainLayoutProps) {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [showSettingsPanel, setShowSettingsPanel] = useState(false);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);

    useEffect(() => {
        const lastJobId = localStorage.getItem(storageSessionKey);
        handleLoadJob(lastJobId || null);
    }, [storageSessionKey]);

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
        <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] font-sans text-[var(--text)] selection:bg-[var(--accent-soft)]">
            {showSettingsPanel ? (
                <Suspense fallback={<aside className="h-full w-80 border-r border-[var(--border)] bg-[var(--panel-muted)]/60" />}>
                    <SettingsPanel />
                </Suspense>
            ) : (
                <aside className="h-full w-80 border-r border-[var(--border)] bg-[var(--panel-muted)]/60" />
            )}

            <main className="relative flex h-full min-w-0 flex-1 flex-col bg-[var(--bg)]">
                {children}
            </main>

            {showHistoryPanel ? (
                <Suspense fallback={<aside className="h-full w-[420px] border-l border-[var(--border)] bg-[var(--panel-muted)]/60" />}>
                    <HistoryPanel
                        currentJobId={currentJobId}
                        onLoadJob={handleLoadJob}
                        onGeneratePlanFromReframe={handlePlanWithImage}
                    />
                </Suspense>
            ) : (
                <aside className="h-full w-[420px] border-l border-[var(--border)] bg-[var(--panel-muted)]/60" />
            )}
        </div>
    );
}
