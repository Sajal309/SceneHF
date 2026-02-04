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
    SKIPPED = 'SKIPPED',
    CANCELLED = 'CANCELLED'
}

export enum StepType {
    ANALYZE = 'ANALYZE',
    EXTRACT = 'EXTRACT',
    REMOVE = 'REMOVE',
    BG_REMOVE = 'BG_REMOVE',
    REFRAME = 'REFRAME',
    EDIT = 'EDIT'
}

export enum AssetKind {
    SOURCE = 'SOURCE',
    PLATE = 'PLATE',
    LAYER = 'LAYER',
    MASK = 'MASK',
    BG_REMOVED = 'BG_REMOVED',
    DEBUG = 'DEBUG',
    GENERATION = 'GENERATION'
}

export interface Asset {
    id: string;
    kind: AssetKind;
    path: string;
    width?: number;
    height?: number;
    created_at: string;
    step_id?: string;
    run_id?: string;
    model?: string;
    prompt_hash?: string;
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
    mask_mode?: 'NONE' | 'AUTO' | 'MANUAL';
    mask_asset_id?: string | null;
    mask_intent?: 'INPAINT_REMOVE' | 'INPAINT_INSERT' | 'EXTRACT_HELPER' | null;
    mask_prompt?: string | null;
    prompt: string;
    prompt_variations?: string[];
    custom_prompt?: string;
    image_config?: Record<string, any>;
    validation?: ValidationResult;
    actions_available: string[];
    logs: string[];
    outputs_history: string[];
    last_run_id?: string;
    last_prompt_used?: string;
    created_at: string;
    updated_at: string;
}

export interface PlanStep {
    id: string;
    name: string;
    type: StepType;
    target: string;
    prompt: string;
    prompt_variations?: string[];
    validate: Record<string, number>;
    fallbacks: any[];
}

export interface Plan {
    scene_summary: string;
    agentic_analysis?: {
        mode?: string;
        scene_complexity?: string;
        estimated_layer_count?: number;
        risk_level?: string;
        decision_rationale?: string;
        potential_challenges?: string[];
        recommended_next_actions?: Array<{ action: string; reason: string }>;
    };
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
    metadata?: Record<string, any>;
    storage_root?: string;
    created_at: string;
    updated_at: string;
}

export interface StepHistoryEntry {
    job_id: string;
    step_id: string;
    run_id: string;
    started_at?: string;
    finished_at?: string;
    model?: string;
    prompt_full?: string;
    prompt_base?: string;
    prompt_custom?: string | null;
    input_asset_path?: string;
    output_asset_id?: string;
    mask?: {
        mask_mode?: string;
        mask_asset_path?: string | null;
        mask_intent?: string | null;
    };
    output_asset_path?: string | null;
    validation?: {
        status?: string;
        metrics?: Record<string, number>;
        notes?: string;
    };
    error?: string | null;
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
        if (!res.ok) {
            let errorMsg = `Failed to get job (${res.status})`;
            try {
                const errorData = await res.json();
                if (errorData?.detail) errorMsg = errorData.detail;
            } catch (e) {
                // ignore
            }
            throw new Error(errorMsg);
        }
        return res.json();
    },

    async planJob(
        jobId: string,
        provider: string = 'openai',
        modelConfig: Record<string, any> = {},
        imageConfig: Record<string, any> = {},
        headers: Record<string, string> = {},
        sceneDescription?: string,
        layerCount?: number,
        layerMap?: any[]
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
                image_config: imageConfig,
                scene_description: sceneDescription,
                layer_count: layerCount,
                layer_map: layerMap
            })
        });

        if (!res.ok) {
            let errorMsg = 'Failed to plan job';
            try {
                const errorData = await res.json();
                if (errorData.detail) errorMsg = errorData.detail;
            } catch (e) {
                // ignore
            }
            throw new Error(errorMsg);
        }
        return res.json();
    },

    async runJob(jobId: string, headers: Record<string, string> = {}): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/run`, {
            method: 'POST',
            headers: {
                ...headers
            }
        });

        if (!res.ok) throw new Error('Failed to run job');
        return res.json();
    },

    async reframeJob(
        jobId: string,
        imageConfig: Record<string, any> = {},
        headers: Record<string, string> = {}
    ): Promise<{ message: string; step_id: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/reframe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                image_config: imageConfig
            })
        });

        if (!res.ok) throw new Error('Failed to reframe job');
        return res.json();
    },

    async editJob(
        jobId: string,
        prompt: string,
        imageConfig: Record<string, any> = {},
        headers: Record<string, string> = {}
    ): Promise<{ message: string; step_id: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/edit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                prompt,
                image_config: imageConfig
            })
        });

        if (!res.ok) throw new Error('Failed to edit image');
        return res.json();
    },

    async runStep(jobId: string, stepId: string, headers: Record<string, string> = {}): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/run`, {
            method: 'POST',
            headers: {
                ...headers
            }
        });

        if (!res.ok) throw new Error('Failed to run step');
        return res.json();
    },

    async retryStep(
        jobId: string,
        stepId: string,
        customPrompt: string,
        imageConfig?: Record<string, any>,
        headers: Record<string, string> = {}
    ): Promise<any> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/retry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                custom_prompt: customPrompt,
                image_config: imageConfig
            })
        });

        if (!res.ok) throw new Error('Failed to retry step');
        return res.json();
    },

    async bgRemoveStep(jobId: string, stepId: string, headers: Record<string, string> = {}): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/bg-remove`, {
            method: 'POST',
            headers: {
                ...headers
            }
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

    getAssetUrl(jobId: string, asset_id: string): string {
        // Use 5-minute intervals for cache-busting to prevent broken links
        // while still ensuring fresh images after regeneration
        const fiveMinutes = 5 * 60 * 1000;
        const stableTimestamp = Math.floor(Date.now() / fiveMinutes) * fiveMinutes;
        return `${API_BASE}/jobs/${jobId}/assets/${asset_id}?t=${stableTimestamp}`;
    },

    async stopStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/stop`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to stop step');
        return res.json();
    },

    async replaceStepImage(
        jobId: string,
        stepId: string,
        file: File,
        target: 'output' | 'input' = 'output'
    ): Promise<{ message: string; asset_id: string; target: string }> {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/replace-image?target=${target}`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to replace step image');
        return res.json();
    },

    async uploadMask(jobId: string, file: File): Promise<{ asset_id: string; width: number; height: number }> {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/jobs/${jobId}/assets/mask`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to upload mask');
        return res.json();
    },

    async patchStep(
        jobId: string,
        stepId: string,
        payload: { mask_mode?: string; mask_asset_id?: string | null; mask_intent?: string | null; mask_prompt?: string | null }
    ): Promise<Step> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to update step');
        return res.json();
    },

    async deleteJob(jobId: string): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete job');
        return res.json();
    },

    async pauseAllJobs(): Promise<{ message: string }> {
        const res = await fetch(`${API_BASE}/jobs/pause-all`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to pause all jobs');
        return res.json();
    },

    async getPromptVariations(
        jobId: string,
        stepId: string,
        provider: string,
        modelConfig: Record<string, any>,
        headers: Record<string, string>
    ): Promise<{ variations: string[] }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/variations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                provider,
                model_config: modelConfig
            })
        });

        if (!res.ok) throw new Error('Failed to get prompt variations');
        return res.json();
    },

    getExportUrl(jobId: string): string {
        return `${API_BASE}/jobs/${jobId}/export`;
    },

    async openInFinder(jobId: string): Promise<{ ok: boolean; path: string }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/open-in-finder`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to open in Finder');
        return res.json();
    },

    async getStepHistory(jobId: string, stepId: string): Promise<{ history: StepHistoryEntry[] }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/history`);
        if (!res.ok) throw new Error('Failed to load step history');
        return res.json();
    },

    async setActiveOutput(jobId: string, stepId: string, assetId: string): Promise<{ ok: boolean }> {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/steps/${stepId}/set-active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asset_id: assetId })
        });
        if (!res.ok) throw new Error('Failed to set active output');
        return res.json();
    }
};
