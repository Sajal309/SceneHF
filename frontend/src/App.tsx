import { useState } from 'react';
import { MainLayout } from './layouts/MainLayout';
import { Workspace } from './components/workspace/Workspace';

function App() {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);

    return (
        <MainLayout onLoadJob={setCurrentJobId}>
            <Workspace jobId={currentJobId} onJobCreated={setCurrentJobId} />
        </MainLayout>
    );
}

export default App;
