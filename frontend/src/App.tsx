import { Suspense, lazy, useEffect, useState } from 'react';
import { MainLayout } from './layouts/MainLayout';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { api, runtimeStorage } from './lib/api';

const Workspace = lazy(async () => {
    const mod = await import('./components/workspace/Workspace');
    return { default: mod.Workspace };
});

function buildStorageSessionKey(storageMode: string | null, folderName: string | null) {
    if (!storageMode) return 'scenehf_last_job_pending';
    const suffix = storageMode === 'local-folder'
        ? `local_${(folderName || 'unbound').replace(/[^a-z0-9_-]+/gi, '_')}`
        : 'browser';
    return `scenehf_last_job_${suffix}`;
}

function StorageGate({ onReady }: { onReady: () => void }) {
    const { settings, updateSettings } = useSettings();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (settings.storageMode) {
            onReady();
        }
    }, [onReady, settings.storageMode]);

    const handleBrowserStorage = async () => {
        setBusy(true);
        setError(null);
        try {
            await runtimeStorage.useBrowserStorage();
            updateSettings({ storageMode: 'browser', storageFolderName: null });
            onReady();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start browser storage.');
        } finally {
            setBusy(false);
        }
    };

    const handleLocalFolder = async () => {
        setBusy(true);
        setError(null);
        try {
            const folderName = await runtimeStorage.useLocalFolder();
            updateSettings({ storageMode: 'local-folder', storageFolderName: folderName });
            onReady();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect local folder.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg)] px-6">
            <div className="glass-panel w-full max-w-3xl rounded-[32px] p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-subtle)]">Session Setup</p>
                <h1 className="mt-3 text-3xl font-semibold text-[var(--text)]">Choose where SceneHF stores this session</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                    Choose the storage mode for this browser session. The workflow stays the same after this, and the choice remains fixed until the session ends.
                </p>

                <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <button
                        onClick={handleBrowserStorage}
                        disabled={busy}
                        className="glass-card rounded-[28px] border p-6 text-left transition hover:border-[var(--accent)]"
                    >
                        <div className="text-lg font-semibold">Browser Storage</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                            Persist jobs and assets inside the browser with no filesystem prompt. Best default for a browser-only session.
                        </p>
                    </button>

                    <button
                        onClick={handleLocalFolder}
                        disabled={busy || !runtimeStorage.localFolderSupported}
                        className="glass-card rounded-[28px] border p-6 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <div className="text-lg font-semibold">Local Folder</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                            Pick a folder on this device. SceneHF mirrors job files there and reloads them next session.
                        </p>
                        {!runtimeStorage.localFolderSupported && (
                            <p className="mt-3 text-xs font-medium text-[var(--warning)]">This browser does not support the File System Access API.</p>
                        )}
                    </button>
                </div>

                {busy && <p className="mt-5 text-sm text-[var(--text-muted)]">Preparing storage…</p>}
                {error && <p className="mt-5 text-sm text-[var(--danger)]">{error}</p>}
            </div>
        </div>
    );
}

function AppShell() {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [pendingPlanFile, setPendingPlanFile] = useState<File | null>(null);
    const { settings } = useSettings();
    const [storageReady, setStorageReady] = useState(Boolean(settings.storageMode));
    const storageSessionKey = buildStorageSessionKey(settings.storageMode, settings.storageFolderName);

    const handleLoadJob = (jobId: string | null) => {
        setCurrentJobId(jobId);
        if (jobId) {
            setPendingPlanFile(null);
        }
    };

    const handlePlanFromReframe = (file: File) => {
        setPendingPlanFile(file);
        setCurrentJobId(null);
    };

    useEffect(() => {
        setStorageReady(Boolean(settings.storageMode));
    }, [settings.storageMode]);

    useEffect(() => {
        if (!storageReady || !settings.storageMode) return;

        let cancelled = false;

        const syncStorageSession = async () => {
            try {
                const jobs = await api.listJobs();
                if (cancelled) return;
                if (jobs.length === 0) {
                    localStorage.removeItem(storageSessionKey);
                    setCurrentJobId(null);
                    setPendingPlanFile(null);
                    return;
                }

                const storedJobId = localStorage.getItem(storageSessionKey);
                if (storedJobId && jobs.some((job) => job.id === storedJobId)) {
                    setCurrentJobId(storedJobId);
                    return;
                }

                setCurrentJobId(null);
            } catch (error) {
                console.error('Failed to sync storage session:', error);
                if (!cancelled) {
                    setCurrentJobId(null);
                    setPendingPlanFile(null);
                }
            }
        };

        void syncStorageSession();

        return () => {
            cancelled = true;
        };
    }, [storageReady, settings.storageMode, settings.storageFolderName, storageSessionKey]);

    if (!storageReady || !settings.storageMode) {
        return <StorageGate onReady={() => setStorageReady(true)} />;
    }

    return (
        <MainLayout
            onLoadJob={handleLoadJob}
            onPlanWithImage={handlePlanFromReframe}
            storageSessionKey={storageSessionKey}
        >
            <Suspense fallback={<div className="h-full w-full p-6 text-sm text-slate-500">Loading workspace...</div>}>
                <Workspace
                    jobId={currentJobId}
                    onJobCreated={handleLoadJob}
                    prefillImage={pendingPlanFile}
                    onPrefillImageUsed={() => setPendingPlanFile(null)}
                    storageSessionKey={storageSessionKey}
                />
            </Suspense>
        </MainLayout>
    );
}

function App() {
    return (
        <SettingsProvider>
            <AppShell />
        </SettingsProvider>
    );
}

export default App;
