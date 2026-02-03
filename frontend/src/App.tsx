import { useState } from 'react';
import { MainLayout } from './layouts/MainLayout';
import { Workspace } from './components/workspace/Workspace';

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
            <Workspace
                jobId={currentJobId}
                onJobCreated={handleLoadJob}
                prefillImage={pendingPlanFile}
                onPrefillImageUsed={() => setPendingPlanFile(null)}
            />
        </MainLayout>
    );
}

export default App;
