// Type definitions matching backend schemas
export enum JobStatus {
    IDLE = 'IDLE',
    PLANNED = 'PLANNED',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    DONE = 'DONE',
    FAILED = 'FAILED'
}

export enum StepStatus {
    QUEUED = 'QUEUED',
    RUNNING = 'RUNNING',
    SUCCESS = 'SUCCESS',
    NEEDS_REVIEW = 'NEEDS_REVIEW',
    FAILED = 'FAILED',
    SKIPPED = 'SKIPPED'
}

export enum StepType {
    ANALYZE = 'ANALYZE',
    EXTRACT = 'EXTRACT',
    REMOVE = 'REMOVE',
    BG_REMOVE = 'BG_REMOVE'
}

export enum AssetKind {
    SOURCE = 'SOURCE',
    PLATE = 'PLATE',
    LAYER = 'LAYER',
    BG_REMOVED = 'BG_REMOVED',
    DEBUG = 'DEBUG'
}

export interface Asset {
    id: string;
    kind: AssetKind;
    path: string;
    width?: number;
    height?: number;
    created_at: string;
}

export interface ValidationResult {
    passed: boolean;
    status: StepStatus;
    metrics: Record<string, number>;
    notes: string;
}

export interface Step {
    id: string;
    index: number;
    name: string;
    type: StepType;
    status: StepStatus;
    input_asset_id?: string;
    output_asset_id?: string;
    prompt: string;
    custom_prompt?: string;
    validation?: ValidationResult;
    actions_available: string[];
    logs: string[];
    created_at: string;
    updated_at: string;
}

export interface PlanStep {
    id: string;
    name: string;
    type: StepType;
    target: string;
    prompt: string;
    validate: Record<string, number>;
    fallbacks: any[];
}

export interface Plan {
    scene_summary: string;
    global_rules: string[];
    steps: PlanStep[];
}

export interface Job {
    id: string;
    status: JobStatus;
    source_image?: string;
    plan?: Plan;
    steps: Step[];
    assets: Record<string, Asset>;
    created_at: string;
    updated_at: string;
}

// API Client
const API_BASE = '/api';

export const api = {
    // Jobs
    async listJobs(): Promise<Job[]> {
        const res = await fetch(`${API_BASE}/jobs`);
        if (!res.ok) throw new Error('Failed to list jobs');
        return res.json();
    },

    async createJob(file: File): Promise<{ job_id: string; message: string }> {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/jobs`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to create job');
        return res.json();
    },

    async getJob(jobId: string): Promise<Job> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`);
        if (!res.ok) throw new Error('Failed to get job');
        return res.json();
    },

    async planJob(
        jobId: string,
        provider: string = 'gemini',
        modelConfig: Record<string, any> = {},
        imageConfig: Record<string, any> = {},
        headers: Record<string, string> = {}
    ): Promise<{ message: string; steps: number }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/plan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                provider,
                model_config: modelConfig,
                image_config: imageConfig
            })
        });

        if (!res.ok) throw new Error('Failed to plan job');
        return res.json();
    },

    async runJob(jobId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/run`, {
            method: 'POST'
        });

        if (!res.ok) throw new Error('Failed to run job');
        return res.json();
    },

    async runStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/run`, {
            method: 'POST'
        });

        if (!res.ok) throw new Error('Failed to run step');
        return res.json();
    },

    async retryStep(jobId: string, stepId: string, customPrompt: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_prompt: customPrompt })
        });

        if (!res.ok) throw new Error('Failed to retry step');
        return res.json();
    },

    async bgRemoveStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/bg-remove`, {
            method: 'POST'
        });

        if (!res.ok) throw new Error('Failed to remove background');
        return res.json();
    },

    async plateAndRetry(
        jobId: string,
        stepId: string,
        removePrompt: string,
        retryPrompt: string
    ): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/plate-and-retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remove_prompt: removePrompt, retry_prompt: retryPrompt })
        });

        if (!res.ok) throw new Error('Failed to create plate and retry');
        return res.json();
    },

    async acceptStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/accept`, {
            method: 'POST'
        });

        if (!res.ok) throw new Error('Failed to accept step');
        return res.json();
    },

    getAssetUrl(jobId: string, assetId: string): string {
        return `${API_BASE}/jobs/${jobId}/assets/${assetId}`;
    },

    async deleteJob(jobId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete job');
        return res.json();
    },

    getExportUrl(jobId: string): string {
        return `${API_BASE}/jobs/${jobId}/export`;
    }
};
