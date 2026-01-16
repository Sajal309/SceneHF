import React, { useState, useEffect } from 'react';
import { SettingsPanel } from '../components/sidebar/SettingsPanel';
import { HistoryPanel } from '../components/sidebar/HistoryPanel';
import { SettingsProvider } from '../context/SettingsContext';

interface MainLayoutProps {
    children: React.ReactNode;
    onLoadJob: (jobId: string) => void;
}

export function MainLayout({ children, onLoadJob }: MainLayoutProps) {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);

    // Restore last job on mount
    useEffect(() => {
        const lastJobId = localStorage.getItem('scenehf_last_job');
        if (lastJobId) {
            handleLoadJob(lastJobId);
        }
    }, []);

    const handleLoadJob = (jobId: string) => {
        setCurrentJobId(jobId);
        onLoadJob(jobId);
    };

    return (
        <SettingsProvider>
            <div className="flex h-screen w-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans selection:bg-[var(--accent-soft)]">
                {/* Left Sidebar - Settings */}
                <SettingsPanel />

                {/* Center - Workspace */}
                <main className="flex-1 h-full min-w-0 flex flex-col bg-[var(--bg)] relative">
                    {children}
                </main>

                {/* Right Sidebar - History */}
                <HistoryPanel currentJobId={currentJobId} onLoadJob={handleLoadJob} />
            </div>
        </SettingsProvider>
    );
}
