import { Suspense, lazy, useState } from 'react';
import { MainLayout } from './layouts/MainLayout';

const Workspace = lazy(async () => {
    const mod = await import('./components/workspace/Workspace');
    return { default: mod.Workspace };
});

function App() {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [pendingPlanFile, setPendingPlanFile] = useState<File | null>(null);

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

    return (
        <MainLayout onLoadJob={handleLoadJob} onPlanWithImage={handlePlanFromReframe}>
            <Suspense fallback={<div className="h-full w-full p-6 text-sm text-slate-500">Loading workspace...</div>}>
                <Workspace
                    jobId={currentJobId}
                    onJobCreated={handleLoadJob}
                    prefillImage={pendingPlanFile}
                    onPrefillImageUsed={() => setPendingPlanFile(null)}
                />
            </Suspense>
        </MainLayout>
    );
}

export default App;
