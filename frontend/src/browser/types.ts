export type StorageMode = 'memory' | 'local-folder';

export type PlanningProvider = 'local' | 'openai' | 'gemini';

export type BrowserJobStatus = 'IDLE' | 'PLANNED' | 'IN_PROGRESS' | 'DONE';

export type BrowserStepStatus = 'QUEUED' | 'READY' | 'NEEDS_REVIEW' | 'SUCCESS';

export type BrowserStepType = 'EXTRACT' | 'REMOVE' | 'EDIT';

export type BrowserAssetKind = 'SOURCE' | 'OUTPUT' | 'MASK' | 'DERIVED';

export interface BrowserAsset {
    id: string;
    kind: BrowserAssetKind;
    name: string;
    path: string;
    mimeType: string;
    size: number;
    createdAt: string;
    stepId?: string;
}

export interface BrowserStep {
    id: string;
    index: number;
    name: string;
    type: BrowserStepType;
    status: BrowserStepStatus;
    target: string;
    prompt: string;
    outputAssetId?: string;
    outputsHistory: string[];
    logs: string[];
}

export interface BrowserPlan {
    sceneSummary: string;
    globalRules: string[];
    steps: BrowserStep[];
}

export interface BrowserJob {
    id: string;
    name: string;
    status: BrowserJobStatus;
    storageMode: StorageMode;
    createdAt: string;
    updatedAt: string;
    sourceAssetId: string;
    sceneDescription?: string;
    plan?: BrowserPlan;
    steps: BrowserStep[];
    assets: Record<string, BrowserAsset>;
    logs: string[];
}

export interface PlanRequest {
    sceneDescription: string;
    layerCount: number;
    layerNames: string[];
}

export interface ProviderCapability {
    planning: boolean;
    imageGeneration: boolean;
    localFolder: boolean;
    note: string;
}
