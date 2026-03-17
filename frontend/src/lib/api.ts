import { generatePlan } from '../browser/planner';

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
    UPSCALE = 'UPSCALE',
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

type StorageMode = 'browser' | 'local-folder';
type PersistedJob = Job;

const DB_NAME = 'scenehf-runtime';
const JOB_STORE = 'jobs';
const ASSET_STORE = 'assets';
const META_STORE = 'meta';
const ROOT_HANDLE_KEY = 'local-folder-root-handle';
const BROWSER_SESSION_ID_KEY = 'scenehf_browser_session_id';
const EXPORT_CACHE = new Map<string, string>();
const ASSET_URL_CACHE = new Map<string, string>();
const ASSET_BLOB_CACHE = new Map<string, Blob>();
const JOB_CACHE = new Map<string, Job>();

type RuntimeEvent = { type: 'job.updated' | 'step.updated' | 'log'; data: any };
const listeners = new Set<(event: RuntimeEvent) => void>();

interface OpenAiImageConfig {
    apiKey: string;
    model: string;
    quality?: string;
    size?: string;
    background?: 'transparent' | 'opaque' | 'auto';
    inputFidelity?: 'low' | 'high';
    extra?: Record<string, any>;
}

interface GeminiImageConfig {
    apiKey: string;
    model: string;
}

function nowIso() {
    return new Date().toISOString();
}

function uuid(prefix: string) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSettings() {
    try {
        const persistent = JSON.parse(localStorage.getItem('scenehf_settings') || '{}');
        const session = JSON.parse(sessionStorage.getItem('scenehf_session_storage') || '{}');
        const falProxyUrl = typeof persistent.falProxyUrl === 'string' && persistent.falProxyUrl.trim()
            ? persistent.falProxyUrl
            : 'https://scenehf-fal-proxy.sajalrai96309.workers.dev';
        return {
            ...persistent,
            falProxyUrl,
            ...session,
        };
    } catch {
        return {
            falProxyUrl: 'https://scenehf-fal-proxy.sajalrai96309.workers.dev',
        };
    }
}

function getStorageMode(): StorageMode {
    const settings = getSettings();
    return settings.storageMode === 'local-folder' ? 'local-folder' : 'browser';
}

function getBrowserSessionId() {
    const existing = sessionStorage.getItem(BROWSER_SESSION_ID_KEY);
    if (existing) return existing;
    const next = uuid('browser_session');
    sessionStorage.setItem(BROWSER_SESSION_ID_KEY, next);
    return next;
}

function getScopePrefix() {
    const storageMode = getStorageMode();
    if (storageMode === 'local-folder') return 'local';
    return `browser:${getBrowserSessionId()}`;
}

function jobStoreKey(jobId: string) {
    return `${getScopePrefix()}:job:${jobId}`;
}

function assetStoreKey(assetId: string) {
    return `${getScopePrefix()}:asset:${assetId}`;
}

function scopedPrefixFor(kind: 'job' | 'asset') {
    return `${getScopePrefix()}:${kind}:`;
}

async function getImageSize(blob: Blob): Promise<{ width?: number; height?: number }> {
    if (!blob.type.startsWith('image/')) return {};
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            resolve({});
            URL.revokeObjectURL(url);
        };
        img.src = url;
    });
}

function parseAspectRatio(value: string) {
    const [widthPart, heightPart] = value.split(':').map((part) => Number(part.trim()));
    if (!widthPart || !heightPart) return null;
    return widthPart / heightPart;
}

async function enforceAspectRatio(blob: Blob, aspectRatioLabel: string): Promise<Blob> {
    const targetRatio = parseAspectRatio(aspectRatioLabel);
    if (!targetRatio || !blob.type.startsWith('image/')) return blob;

    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load generated image for aspect-ratio enforcement.'));
            img.src = objectUrl;
        });

        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) return blob;

        const sourceRatio = sourceWidth / sourceHeight;
        let targetWidth = sourceWidth;
        let targetHeight = Math.round(targetWidth / targetRatio);

        if (targetHeight > sourceHeight) {
            targetHeight = sourceHeight;
            targetWidth = Math.round(targetHeight * targetRatio);
        }

        if (targetWidth === sourceWidth && targetHeight === sourceHeight) {
            return blob;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) return blob;

        const sourceCropWidth = sourceRatio > targetRatio ? Math.round(sourceHeight * targetRatio) : sourceWidth;
        const sourceCropHeight = sourceRatio > targetRatio ? sourceHeight : Math.round(sourceWidth / targetRatio);
        const sourceX = Math.max(0, Math.floor((sourceWidth - sourceCropWidth) / 2));
        const sourceY = Math.max(0, Math.floor((sourceHeight - sourceCropHeight) / 2));

        context.drawImage(
            image,
            sourceX,
            sourceY,
            sourceCropWidth,
            sourceCropHeight,
            0,
            0,
            targetWidth,
            targetHeight,
        );

        const outputType = blob.type || 'image/png';
        const result = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((value) => resolve(value), outputType, 1);
        });
        return result || blob;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function emit(type: RuntimeEvent['type'], data: any) {
    listeners.forEach((listener) => listener({ type, data }));
}

function cloneJob(job: Job): Job {
    return JSON.parse(JSON.stringify(job)) as Job;
}

function objectUrlFor(assetId: string, blob: Blob) {
    const existing = ASSET_URL_CACHE.get(assetId);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    ASSET_URL_CACHE.set(assetId, url);
    return url;
}

function storagePath(kind: AssetKind, id: string, filename: string) {
    const safeName = filename.replace(/[^a-z0-9_.-]+/gi, '_');
    const folder = kind === AssetKind.SOURCE ? 'source' : kind === AssetKind.MASK ? 'masks' : kind === AssetKind.BG_REMOVED ? 'derived' : 'generations';
    return `assets/${folder}/${id}_${safeName}`;
}

function buildActions(step: Step) {
    const base = ['ACCEPT', 'RETRY'] as string[];
    if (step.type !== StepType.BG_REMOVE) base.push('BG_REMOVE');
    if (step.type === StepType.EXTRACT || step.type === StepType.REMOVE) base.push('PLATE_AND_RETRY');
    return base;
}

function createPlanFromInput(sceneDescription: string | undefined, layerCount: number | undefined, layerMap: any[] | undefined): Plan {
    const count = layerCount || layerMap?.length || 4;
    const names = layerMap?.length
        ? layerMap.map((layer) => String(layer.name || `Layer ${layer.index || 1}`))
        : Array.from({ length: count }, (_, index) => {
            if (index === 0) return 'Foreground elements';
            if (index === count - 1) return 'Background plate';
            return `Layer ${index + 1}`;
        });
    const plan = {
        scene_summary: sceneDescription || 'Browser-local extraction plan.',
        global_rules: [
            'This branch stores data locally in the browser or user-selected folder.',
            'AI actions run only when supported in-browser.',
        ],
        steps: names.map((name, index) => ({
            id: `s${index + 1}`,
            name: `Extract ${name}`,
            type: StepType.EXTRACT,
            target: name,
            prompt: `Isolate ${name} while preserving framing and composition.`,
            prompt_variations: [
                `Extract only ${name}.`,
                `Keep ${name} clean and compositing-ready.`,
                `Separate ${name} from the full scene.`,
            ],
            validate: { min_nonwhite: 0.01, max_nonwhite: 0.8 },
            fallbacks: [],
        })),
    } satisfies Plan;
    return plan;
}

function planToSteps(plan: Plan, job: Job): Step[] {
    return plan.steps.map((step, index) => ({
        id: step.id || `s${index + 1}`,
        index,
        name: step.name,
        type: step.type,
        status: StepStatus.QUEUED,
        input_asset_id: job.source_image,
        prompt: step.prompt,
        prompt_variations: step.prompt_variations || [],
        image_config: job.metadata?.image_config || {},
        actions_available: [],
        logs: [],
        outputs_history: [],
        created_at: nowIso(),
        updated_at: nowIso(),
    }));
}

async function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(JOB_STORE)) db.createObjectStore(JOB_STORE);
            if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
            if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbGet<T>(storeName: string, key: string): Promise<T | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function dbSet(storeName: string, key: string, value: unknown) {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbDelete(storeName: string, key: string) {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbEntries<T>(storeName: string): Promise<Array<[string, T]>> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAllKeys();
        const valueRequest = tx.objectStore(storeName).getAll();
        tx.oncomplete = () => {
            resolve((request.result as string[]).map((key, index) => [key, (valueRequest.result as T[])[index]]));
        };
        tx.onerror = () => reject(tx.error);
    });
}

async function getRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    return dbGet<FileSystemDirectoryHandle>(META_STORE, ROOT_HANDLE_KEY);
}

async function setRootHandle(handle: FileSystemDirectoryHandle) {
    await dbSet(META_STORE, ROOT_HANDLE_KEY, handle);
}

async function queryHandlePermission(handle: FileSystemHandle, mode: FileSystemPermissionMode = 'readwrite') {
    const state = await handle.queryPermission({ mode });
    if (state === 'granted') return true;
    const requested = await handle.requestPermission({ mode });
    return requested === 'granted';
}

async function writeMirrorFile(asset: Asset, blob: Blob, jobId: string) {
    if (getStorageMode() !== 'local-folder') return;
    const root = await getRootHandle();
    if (!root) return;
    const allowed = await queryHandlePermission(root);
    if (!allowed) return;
    const jobDir = await root.getDirectoryHandle(jobId, { create: true });
    const [assetsFolder, subFolder, filename] = asset.path.split('/');
    const assetsDir = await jobDir.getDirectoryHandle(assetsFolder, { create: true });
    const innerDir = await assetsDir.getDirectoryHandle(subFolder, { create: true });
    const fileHandle = await innerDir.getFileHandle(filename, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(blob);
    await writer.close();
    const persisted = await dbGet<PersistedJob>(JOB_STORE, jobStoreKey(jobId));
    if (persisted) {
        await writeMirrorJobFile(persisted);
    }
}

async function writeMirrorJobFile(job: PersistedJob) {
    if (getStorageMode() !== 'local-folder') return;
    const root = await getRootHandle();
    if (!root) return;
    const allowed = await queryHandlePermission(root);
    if (!allowed) return;
    const jobDir = await root.getDirectoryHandle(job.id, { create: true });
    const fileHandle = await jobDir.getFileHandle('job.json', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(JSON.stringify(job, null, 2));
    await writer.close();
}

async function readMirrorBlob(jobId: string, asset: Asset): Promise<Blob | null> {
    if (getStorageMode() !== 'local-folder') return null;
    const root = await getRootHandle();
    if (!root) return null;
    const allowed = await queryHandlePermission(root, 'read');
    if (!allowed) return null;

    try {
        const jobDir = await root.getDirectoryHandle(jobId);
        const [assetsFolder, subFolder, filename] = asset.path.split('/');
        const assetsDir = await jobDir.getDirectoryHandle(assetsFolder);
        const innerDir = await assetsDir.getDirectoryHandle(subFolder);
        const fileHandle = await innerDir.getFileHandle(filename);
        return await fileHandle.getFile();
    } catch {
        return null;
    }
}

async function warmAsset(jobId: string, asset: Asset): Promise<string> {
    const cachedBlob = ASSET_BLOB_CACHE.get(asset.id);
    if (cachedBlob) return objectUrlFor(asset.id, cachedBlob);
    let blob = await dbGet<Blob>(ASSET_STORE, assetStoreKey(asset.id));
    if (!blob) {
        blob = await readMirrorBlob(jobId, asset) || null;
        if (blob) {
            await dbSet(ASSET_STORE, assetStoreKey(asset.id), blob);
        }
    }
    if (!blob) return '';
    ASSET_BLOB_CACHE.set(asset.id, blob);
    return objectUrlFor(asset.id, blob);
}

async function hydrateJob(job: PersistedJob): Promise<Job> {
    const clone = cloneJob(job);
    await Promise.all(Object.values(clone.assets).map(async (asset) => {
        if (asset.path.startsWith('blob:')) return;
        const url = await warmAsset(clone.id, asset);
        if (url) asset.path = url;
    }));
    JOB_CACHE.set(clone.id, clone);
    return clone;
}

async function persistJob(job: Job) {
    const clone = cloneJob(job);
    const existingPersisted = await dbGet<PersistedJob>(JOB_STORE, jobStoreKey(clone.id));
    Object.values(clone.assets).forEach((asset) => {
        const existingAsset = existingPersisted?.assets?.[asset.id];
        if ((asset.path.startsWith('blob:') || asset.path.startsWith('data:')) && existingAsset?.path) {
            asset.path = existingAsset.path;
        }
    });
    await dbSet(JOB_STORE, jobStoreKey(clone.id), clone);
    await writeMirrorJobFile(clone);
}

async function saveBlobAsset(job: Job, blob: Blob, kind: AssetKind, filename: string, stepId?: string) {
    const id = uuid('asset');
    const size = await getImageSize(blob);
    const asset: Asset = {
        id,
        kind,
        path: storagePath(kind, id, filename),
        width: size.width,
        height: size.height,
        created_at: nowIso(),
        step_id: stepId,
    };
    await dbSet(ASSET_STORE, assetStoreKey(id), blob);
    ASSET_BLOB_CACHE.set(id, blob);
    asset.path = objectUrlFor(id, blob);
    job.assets[id] = asset;
    const persistedAsset = { ...asset, path: storagePath(kind, id, filename) };
    const persistedJob = cloneJob(job);
    persistedJob.assets[id] = persistedAsset;
    await dbSet(JOB_STORE, jobStoreKey(job.id), persistedJob);
    await writeMirrorFile(persistedAsset, blob, job.id);
    return asset;
}

function getPersistedPath(jobId: string, assetId: string) {
    const cached = JOB_CACHE.get(jobId)?.assets[assetId];
    if (cached && !cached.path.startsWith('blob:') && !cached.path.startsWith('data:')) return cached.path;
    return null;
}

async function loadJobOrThrow(jobId: string) {
    const stored = await dbGet<PersistedJob>(JOB_STORE, jobStoreKey(jobId));
    if (!stored) throw new Error('Job not found');
    return hydrateJob(stored);
}

async function sourceBlob(job: Job, assetId?: string) {
    const id = assetId || job.source_image;
    if (!id) throw new Error('Missing source image.');
    let blob = ASSET_BLOB_CACHE.get(id) || await dbGet<Blob>(ASSET_STORE, assetStoreKey(id));
    if (!blob) {
        const asset = job.assets[id];
        if (asset) {
            blob = await readMirrorBlob(job.id, asset) || null;
            if (blob) {
                await dbSet(ASSET_STORE, assetStoreKey(id), blob);
            }
        }
    }
    if (!blob) throw new Error('Source asset unavailable.');
    ASSET_BLOB_CACHE.set(id, blob);
    return blob;
}

function logForJob(job: Job, message: string) {
    emit('log', { level: 'info', message, created_at: nowIso() });
    job.metadata = job.metadata || {};
    job.metadata._local_logs = job.metadata._local_logs || [];
    job.metadata._local_logs.unshift({ level: 'info', message, created_at: nowIso() });
}

function recordHistory(job: Job, step: Step, message: string) {
    job.metadata = job.metadata || {};
    const history = (job.metadata._local_history ||= {}) as Record<string, StepHistoryEntry[]>;
    const runId = uuid('run');
    const blobPath = step.output_asset_id ? getPersistedPath(job.id, step.output_asset_id) : null;
    const entry: StepHistoryEntry = {
        job_id: job.id,
        step_id: step.id,
        run_id: runId,
        started_at: nowIso(),
        finished_at: nowIso(),
        prompt_full: step.custom_prompt || step.prompt,
        prompt_base: step.prompt,
        prompt_custom: step.custom_prompt || null,
        output_asset_id: step.output_asset_id,
        output_asset_path: blobPath,
        validation: step.validation ? {
            status: step.validation.status,
            metrics: step.validation.metrics,
            notes: step.validation.notes,
        } : undefined,
        error: null,
    };
    history[step.id] = [entry, ...(history[step.id] || [])];
    logForJob(job, message);
}

async function saveAndEmitJob(job: Job) {
    job.updated_at = nowIso();
    await persistJob(job);
    JOB_CACHE.set(job.id, cloneJob(job));
    emit('job.updated', cloneJob(job));
}

async function saveAndEmitStep(job: Job, step: Step) {
    await saveAndEmitJob(job);
    emit('step.updated', JSON.parse(JSON.stringify(step)));
}

function decodeBase64Image(base64: string, mimeType = 'image/png') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
}

async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function sanitizeOpenAiModel(model?: string) {
    if (!model) return 'gpt-image-1.5';
    if (model.startsWith('gpt-image-1.5')) return 'gpt-image-1.5';
    if (model.startsWith('gpt-image-1-mini')) return 'gpt-image-1-mini';
    if (model.startsWith('gpt-image-1') && !model.includes('mini')) return 'gpt-image-1';
    return model;
}

function sanitizeOpenAiQuality(quality?: unknown) {
    const value = String(quality || 'auto').toLowerCase();
    if (value === 'standard') return 'low';
    if (value === 'hd') return 'high';
    if (['low', 'medium', 'high', 'auto'].includes(value)) return value;
    return 'auto';
}

function getActiveImageConfig(step?: Step, job?: Job) {
    return {
        ...((job?.metadata?.image_config as Record<string, any>) || {}),
        ...(step?.image_config || {}),
    };
}

function resolveImageProvider(imageConfig: Record<string, any>) {
    const provider = String(imageConfig.provider || '').toLowerCase();
    const model = String(imageConfig.model || '').toLowerCase();

    // When the model family is explicit, trust it over a stale provider selection.
    if (model.includes('gemini')) return 'google';
    if (model.includes('gpt-image') || model.includes('dall-e') || model.includes('chatgpt-image')) return 'openai';

    if (provider === 'openai') return 'openai';
    if (provider === 'google') return 'google';
    if (provider === 'vertex') return 'vertex';
    return 'openai';
}

function reframePromptForRatio(aspectRatio: string) {
    return `Reframe this image to a polished ${aspectRatio} composition while preserving subject identity, scene layout, and the original visual intent. Expand the canvas naturally where needed for the new framing. The final output must match the ${aspectRatio} aspect ratio exactly.`;
}

function normalizeProviderError(error: unknown, provider: string) {
    if (error instanceof TypeError && /Failed to fetch/i.test(error.message)) {
        const providerLabel = provider === 'google' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : provider;
        return new Error(`${providerLabel} request could not reach the API. Check internet connectivity, browser blocking/extensions, and whether the API endpoint is reachable from this network.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}

async function openAiGenerateImage(prompt: string, config: OpenAiImageConfig): Promise<Blob> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: sanitizeOpenAiModel(config.model),
            prompt,
            size: config.size || 'auto',
            quality: sanitizeOpenAiQuality(config.quality),
            background: config.background || 'transparent',
            output_format: 'png',
            ...config.extra,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI image generation failed (${response.status}): ${errorText || 'Unknown error'}`);
    }

    const payload = await response.json();
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) {
        throw new Error('OpenAI image generation returned no image data.');
    }
    return decodeBase64Image(b64, 'image/png');
}

async function openAiEditImage(input: Blob, prompt: string, config: OpenAiImageConfig, mask?: Blob): Promise<Blob> {
    const formData = new FormData();
    formData.append('model', sanitizeOpenAiModel(config.model));
    formData.append('prompt', prompt);
    formData.append('size', config.size || 'auto');
    formData.append('quality', sanitizeOpenAiQuality(config.quality));
    formData.append('output_format', 'png');
    if (config.background) formData.append('background', config.background);
    if (config.inputFidelity) formData.append('input_fidelity', config.inputFidelity);
    formData.append('image', new File([input], 'input.png', { type: input.type || 'image/png' }));
    if (mask) {
        formData.append('mask', new File([mask], 'mask.png', { type: mask.type || 'image/png' }));
    }
    if (config.extra) {
        Object.entries(config.extra).forEach(([key, value]) => {
            if (value !== undefined && value !== null && !['provider', 'model', 'quality', 'size', 'background', 'input_fidelity', 'fal_model'].includes(key)) {
                formData.append(key, String(value));
            }
        });
    }

    const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI image edit failed (${response.status}): ${errorText || 'Unknown error'}`);
    }

    const payload = await response.json();
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) {
        throw new Error('OpenAI image edit returned no image data.');
    }
    return decodeBase64Image(b64, 'image/png');
}

function sanitizeGeminiModel(model?: string) {
    if (!model) return 'gemini-2.5-flash-image';
    if (model.startsWith('gemini-2.5-flash-image')) return 'gemini-2.5-flash-image';
    return model;
}

async function geminiGenerateImage(prompt: string, config: GeminiImageConfig, input?: Blob): Promise<Blob> {
    const parts: Array<Record<string, any>> = [{ text: prompt }];
    if (input) {
        parts.push({
            inlineData: {
                mimeType: input.type || 'image/png',
                data: await blobToBase64(input),
            },
        });
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(sanitizeGeminiModel(config.model))}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts,
                }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini image generation failed (${response.status}): ${errorText || 'Unknown error'}`);
    }

    const payload = await response.json();
    const responseParts = payload?.candidates?.[0]?.content?.parts || [];
    const imagePart = responseParts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
    const imageData = imagePart?.inlineData?.data || imagePart?.inline_data?.data;
    const imageMimeType = imagePart?.inlineData?.mimeType || imagePart?.inline_data?.mime_type || 'image/png';
    if (!imageData) {
        const textPart = responseParts.find((part: any) => part?.text)?.text;
        throw new Error(textPart || 'Gemini returned no image output.');
    }

    return decodeBase64Image(
        imageData,
        imageMimeType,
    );
}

function browserFalCapabilityError() {
    return 'Background removal via Fal requires a configured Fal proxy URL. Add your Cloudflare Worker URL in Settings to use Fal with BYOK.';
}

function browserFalUpscaleCapabilityError() {
    return 'Upscale via Fal requires a configured Fal proxy URL. Add your Cloudflare Worker URL in Settings to use Fal with BYOK.';
}

async function falRemoveBackgroundViaProxy(input: Blob, proxyUrl: string, apiKey: string, modelId: string): Promise<Blob> {
    const formData = new FormData();
    formData.append('image', new File([input], 'input.png', { type: input.type || 'image/png' }));
    formData.append('model', modelId);

    const response = await fetch(`${proxyUrl.replace(/\/+$/, '')}/bg-remove`, {
        method: 'POST',
        headers: {
            'x-fal-api-key': apiKey,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fal proxy failed (${response.status}): ${errorText || 'Unknown error'}`);
    }

    return response.blob();
}

async function falUpscaleViaProxy(input: Blob, proxyUrl: string, apiKey: string, modelId: string, factor: number): Promise<Blob> {
    const formData = new FormData();
    formData.append('image', new File([input], 'input.png', { type: input.type || 'image/png' }));
    formData.append('model', modelId);
    formData.append('factor', String(factor));

    const response = await fetch(`${proxyUrl.replace(/\/+$/, '')}/upscale`, {
        method: 'POST',
        headers: {
            'x-fal-api-key': apiKey,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fal upscale proxy failed (${response.status}): ${errorText || 'Unknown error'}`);
    }

    return response.blob();
}

async function generateStepOutput(job: Job, step: Step): Promise<{ blob: Blob; kind: AssetKind; filename: string; note: string }> {
    const settings = getSettings();
    const imageConfig = getActiveImageConfig(step, job);
    const provider = resolveImageProvider(imageConfig);
    const input = await sourceBlob(job, step.input_asset_id);
    const mask = step.mask_asset_id ? await sourceBlob(job, step.mask_asset_id) : undefined;
    const prompt = step.custom_prompt || step.prompt;

    let blob: Blob;
    let note: string;
    const reframeAspectRatio = String(imageConfig.reframe_aspect_ratio || '16:9');

    if (provider === 'openai') {
        const apiKey = settings.imageApiKey || settings.apiKey;
        if (!apiKey) {
            throw new Error('Missing OpenAI image API key. Add it in Settings to run image generation.');
        }

        const openAiConfig: OpenAiImageConfig = {
            apiKey,
            model: String(imageConfig.model || settings.imageModel || 'gpt-image-1.5'),
            quality: imageConfig.quality || 'auto',
            size: imageConfig.size || 'auto',
            background: step.type === StepType.EXTRACT ? 'transparent' : 'opaque',
            inputFidelity: mask || step.type === StepType.EDIT || step.type === StepType.REMOVE || step.type === StepType.REFRAME ? 'high' : undefined,
            extra: imageConfig,
        };

        try {
            if (step.type === StepType.EXTRACT && !mask) {
                blob = await openAiGenerateImage(prompt, { ...openAiConfig, background: 'transparent' });
            } else {
                blob = await openAiEditImage(input, prompt, openAiConfig, mask);
            }
        } catch (error) {
            throw normalizeProviderError(error, provider);
        }
        note = 'Generated with OpenAI image API.';
    } else if (provider === 'google') {
        const apiKey = settings.imageApiKey || settings.apiKey;
        if (!apiKey) {
            throw new Error('Missing Google AI API key. Add it in Settings to run Gemini image generation.');
        }
        try {
            blob = await geminiGenerateImage(
                prompt,
                {
                    apiKey,
                    model: String(imageConfig.model || settings.imageModel || 'gemini-2.5-flash-image'),
                },
                step.type === StepType.EXTRACT && !mask ? undefined : input,
            );
        } catch (error) {
            throw normalizeProviderError(error, provider);
        }
        note = 'Generated with Gemini image API.';
    } else {
        throw new Error(`${provider} image execution is not enabled in this browser runtime yet.`);
    }

    if (step.type === StepType.REFRAME) {
        blob = await enforceAspectRatio(blob, reframeAspectRatio);
        note = `${note} Cropped to exact ${reframeAspectRatio}.`;
    }

    const filename = `${step.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'output'}.png`;
    return {
        blob,
        kind: AssetKind.GENERATION,
        filename,
        note,
    };
}

export const runtimeStorage = {
    localFolderSupported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    async useBrowserStorage() {
        return true;
    },
    async useLocalFolder() {
        if (!(typeof window !== 'undefined' && 'showDirectoryPicker' in window)) {
            throw new Error('This browser does not support local folder storage.');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const ok = await queryHandlePermission(handle);
        if (!ok) throw new Error('Folder permission was not granted.');
        await setRootHandle(handle);
        return handle.name || 'Selected folder';
    },
    async reconnectLocalFolder() {
        const handle = await getRootHandle();
        if (!handle) return null;
        const ok = await queryHandlePermission(handle);
        return ok ? (handle.name || 'Selected folder') : null;
    },
};

export const runtimeEvents = {
    subscribe(listener: (event: RuntimeEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

export const api = {
    async listJobs(): Promise<Job[]> {
        const entries = await dbEntries<PersistedJob>(JOB_STORE);
        const prefix = scopedPrefixFor('job');
        const jobs = await Promise.all(
            entries
                .filter(([key]) => key.startsWith(prefix))
                .map(([, value]) => hydrateJob(value))
        );
        jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return jobs;
    },

    async createJob(file: File): Promise<{ job_id: string; message: string }> {
        const now = nowIso();
        const job: Job = {
            id: uuid('job'),
            status: JobStatus.IDLE,
            steps: [],
            assets: {},
            metadata: {
                image_config: {},
                _local_logs: [],
                _local_history: {},
            },
            created_at: now,
            updated_at: now,
        };
        const asset = await saveBlobAsset(job, file, AssetKind.SOURCE, file.name);
        job.source_image = asset.id;
        await saveAndEmitJob(job);
        logForJob(job, `Job created from ${file.name}`);
        await saveAndEmitJob(job);
        return { job_id: job.id, message: 'Job created successfully' };
    },

    async getJob(jobId: string): Promise<Job> {
        return loadJobOrThrow(jobId);
    },

    async planJob(jobId: string, provider = 'openai', _modelConfig: Record<string, any> = {}, imageConfig: Record<string, any> = {}, _headers: Record<string, string> = {}, sceneDescription?: string, layerCount?: number, layerMap?: any[], _excludeCharacters?: boolean): Promise<{ message: string; steps: number }> {
        const job = await loadJobOrThrow(jobId);
        job.metadata = job.metadata || {};
        job.metadata.image_config = imageConfig;
        const apiKey = provider === 'gemini' ? getSettings().apiKey : getSettings().apiKey;
        let plan = createPlanFromInput(sceneDescription, layerCount, layerMap);
        try {
            if (provider === 'openai' || provider === 'gemini') {
                const planned = await generatePlan(provider as 'openai' | 'gemini' | 'local', apiKey || '', {
                    sceneDescription: sceneDescription || '',
                    layerCount: layerCount || layerMap?.length || 4,
                    layerNames: Array.isArray(layerMap) ? layerMap.map((item) => String(item.name || 'Layer')) : [],
                });
                plan = {
                    scene_summary: planned.sceneSummary,
                    global_rules: planned.globalRules,
                    steps: planned.steps.map((step) => ({
                        id: step.id,
                        name: step.name,
                        type: step.type as unknown as StepType,
                        target: step.target,
                        prompt: step.prompt,
                        prompt_variations: [],
                        validate: {},
                        fallbacks: [],
                    })),
                };
            }
        } catch {
            // fall back to local plan
        }

        job.plan = plan;
        job.steps = planToSteps(plan, job);
        job.status = JobStatus.PLANNED;
        job.updated_at = nowIso();
        logForJob(job, `Plan generated with ${provider}.`);
        await saveAndEmitJob(job);
        return { message: 'Plan generated', steps: job.steps.length };
    },

    async runJob(jobId: string): Promise<{ message: string }> {
        const job = await loadJobOrThrow(jobId);
        job.status = JobStatus.RUNNING;
        await saveAndEmitJob(job);
        for (const step of job.steps) {
            if (step.status === StepStatus.SUCCESS) continue;
            await this.runStep(jobId, step.id);
        }
        const latest = await loadJobOrThrow(jobId);
        latest.status = latest.steps.every((step) => step.status === StepStatus.SUCCESS) ? JobStatus.DONE : JobStatus.PAUSED;
        await saveAndEmitJob(latest);
        return { message: 'Run complete' };
    },

    async reframeJob(jobId: string, imageConfig: Record<string, any> = {}, _headers: Record<string, string> = {}): Promise<{ message: string; step_id: string }> {
        const job = await loadJobOrThrow(jobId);
        job.metadata = job.metadata || {};
        job.metadata.image_config = imageConfig;
        const aspectRatio = String(imageConfig.reframe_aspect_ratio || '16:9');
        const step: Step = {
            id: uuid('s'),
            index: job.steps.length,
            name: `Reframe ${aspectRatio}`,
            type: StepType.REFRAME,
            status: StepStatus.QUEUED,
            input_asset_id: job.source_image,
            output_asset_id: undefined,
            prompt: imageConfig.reframe_prompt || reframePromptForRatio(aspectRatio),
            actions_available: buildActions({ type: StepType.REFRAME } as Step),
            logs: [],
            outputs_history: [],
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        job.steps.push(step);
        job.status = JobStatus.RUNNING;
        await saveAndEmitJob(job);
        await this.runStep(jobId, step.id);
        return { message: 'Reframe started', step_id: step.id };
    },

    async editJob(jobId: string, prompt: string, imageConfig: Record<string, any> = {}, _headers: Record<string, string> = {}, inputAssetId?: string, _styleReferenceJobId?: string, _styleReferenceAssetId?: string, _sceneSequenceId?: string): Promise<{ message: string; step_id: string }> {
        const job = await loadJobOrThrow(jobId);
        job.metadata = job.metadata || {};
        job.metadata.image_config = imageConfig;
        const step: Step = {
            id: uuid('s'),
            index: job.steps.length,
            name: 'Edit scene',
            type: StepType.EDIT,
            status: StepStatus.QUEUED,
            input_asset_id: inputAssetId || job.source_image,
            output_asset_id: undefined,
            prompt,
            actions_available: buildActions({ type: StepType.EDIT } as Step),
            logs: [],
            outputs_history: [],
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        job.steps.push(step);
        job.status = JobStatus.RUNNING;
        await saveAndEmitJob(job);
        await this.runStep(jobId, step.id);
        return { message: 'Edit started', step_id: step.id };
    },

    async runStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        step.status = StepStatus.RUNNING;
        step.logs.unshift('Submitting image generation request...');
        await saveAndEmitStep(job, step);
        try {
            const output = await generateStepOutput(job, step);
            const asset = await saveBlobAsset(job, output.blob, output.kind, output.filename, step.id);
            step.output_asset_id = asset.id;
            step.outputs_history.push(asset.id);
            step.status = StepStatus.NEEDS_REVIEW;
            step.actions_available = buildActions(step);
            step.validation = {
                passed: true,
                status: StepStatus.NEEDS_REVIEW,
                metrics: {},
                notes: output.note,
            };
            step.logs.unshift(output.note);
            step.updated_at = nowIso();
            job.status = JobStatus.PAUSED;
            recordHistory(job, step, `${step.name} completed via browser API call.`);
            await saveAndEmitStep(job, step);
            return { message: 'Step completed' };
        } catch (error) {
            step.status = StepStatus.FAILED;
            step.updated_at = nowIso();
            step.logs.unshift(error instanceof Error ? error.message : 'Step failed.');
            job.status = JobStatus.PAUSED;
            await saveAndEmitStep(job, step);
            throw error;
        }
    },

    async retryStep(jobId: string, stepId: string, customPrompt: string, imageConfig?: Record<string, any>, _headers: Record<string, string> = {}): Promise<any> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        step.custom_prompt = customPrompt;
        if (imageConfig) step.image_config = imageConfig;
        return this.runStep(jobId, stepId);
    },

    async bgRemoveStep(jobId: string, stepId: string, _headers: Record<string, string> = {}): Promise<{ message: string }> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        const settings = getSettings();
        if (!settings.falProxyUrl) {
            const message = browserFalCapabilityError();
            step.status = StepStatus.FAILED;
            step.updated_at = nowIso();
            step.logs.unshift(message);
            job.status = JobStatus.PAUSED;
            await saveAndEmitStep(job, step);
            throw new Error(message);
        }
        if (!settings.falApiKey) {
            throw new Error('Missing Fal API key. Add your key in Settings to use the Fal proxy.');
        }

        const assetId = step.output_asset_id || step.input_asset_id || job.source_image;
        if (!assetId) throw new Error('No image available for background removal.');
        const blob = await sourceBlob(job, assetId);

        step.logs.unshift('Submitting background removal to Fal proxy...');
        step.status = StepStatus.RUNNING;
        await saveAndEmitStep(job, step);

        try {
            const outputBlob = await falRemoveBackgroundViaProxy(
                blob,
                String(settings.falProxyUrl),
                String(settings.falApiKey),
                String(settings.falModel || 'fal-ai/imageutils/rembg'),
            );
            const asset = await saveBlobAsset(job, outputBlob, AssetKind.BG_REMOVED, 'bg_removed.png', step.id);
            step.output_asset_id = asset.id;
            step.outputs_history.push(asset.id);
            step.status = StepStatus.NEEDS_REVIEW;
            step.validation = {
                passed: true,
                status: StepStatus.NEEDS_REVIEW,
                metrics: {},
                notes: 'Background removed through Fal proxy.',
            };
            step.logs.unshift('Background removal completed.');
            job.status = JobStatus.PAUSED;
            recordHistory(job, step, 'Background removal completed via Fal proxy.');
            await saveAndEmitStep(job, step);
            return { message: 'Background removed' };
        } catch (error) {
            step.status = StepStatus.FAILED;
            step.updated_at = nowIso();
            step.logs.unshift(error instanceof Error ? error.message : 'Background removal failed.');
            job.status = JobStatus.PAUSED;
            await saveAndEmitStep(job, step);
            throw error;
        }
    },

    async bgRemoveSource(_jobId: string, _falModel?: string, _headers: Record<string, string> = {}): Promise<{ message: string; step_id: string }> {
        const job = await loadJobOrThrow(_jobId);
        const step: Step = {
            id: uuid('s'),
            index: job.steps.length,
            name: 'Remove background',
            type: StepType.BG_REMOVE,
            status: StepStatus.QUEUED,
            input_asset_id: job.source_image,
            prompt: 'Remove the background and keep only the foreground subject with a clean alpha channel.',
            actions_available: buildActions({ type: StepType.BG_REMOVE } as Step),
            logs: [],
            outputs_history: [],
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        job.steps.push(step);
        job.status = JobStatus.RUNNING;
        await saveAndEmitJob(job);
        await this.bgRemoveStep(_jobId, step.id, _headers);
        return { message: 'Background removal started', step_id: step.id };
    },

    async upscaleSource(jobId: string, _upscaleModel?: string, _factor?: number, _headers: Record<string, string> = {}): Promise<{ message: string; step_id: string }> {
        const job = await loadJobOrThrow(jobId);
        const settings = getSettings();
        const factor = Math.max(1, Math.min(6, Number(_factor || 2) || 2));
        const step: Step = {
            id: uuid('s'),
            index: job.steps.length,
            name: 'Upscale source',
            type: StepType.UPSCALE,
            status: StepStatus.QUEUED,
            input_asset_id: job.source_image,
            prompt: `Upscale this image by ${factor}x while preserving details and overall composition.`,
            actions_available: buildActions({ type: StepType.UPSCALE } as Step),
            logs: [],
            outputs_history: [],
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        job.steps.push(step);
        job.status = JobStatus.RUNNING;
        await saveAndEmitJob(job);

        if (!settings.falProxyUrl) {
            const message = browserFalUpscaleCapabilityError();
            step.status = StepStatus.FAILED;
            step.updated_at = nowIso();
            step.logs.unshift(message);
            job.status = JobStatus.PAUSED;
            await saveAndEmitStep(job, step);
            throw new Error(message);
        }
        if (!settings.falApiKey) {
            throw new Error('Missing Fal API key. Add your key in Settings to use the Fal proxy.');
        }
        if (!job.source_image) {
            throw new Error('Missing source image.');
        }

        step.status = StepStatus.RUNNING;
        step.logs.unshift('Submitting upscale to Fal proxy...');
        await saveAndEmitStep(job, step);

        try {
            const inputBlob = await sourceBlob(job, job.source_image);
            const outputBlob = await falUpscaleViaProxy(
                inputBlob,
                String(settings.falProxyUrl),
                String(settings.falApiKey),
                String(_upscaleModel || settings.upscaleModel || 'fal-ai/imageutils/upscale'),
                factor,
            );
            const asset = await saveBlobAsset(job, outputBlob, AssetKind.GENERATION, `upscale_${factor}x.png`, step.id);
            step.output_asset_id = asset.id;
            step.outputs_history.push(asset.id);
            step.status = StepStatus.NEEDS_REVIEW;
            step.validation = {
                passed: true,
                status: StepStatus.NEEDS_REVIEW,
                metrics: {},
                notes: `Upscaled ${factor}x through Fal proxy.`,
            };
            step.logs.unshift('Upscale completed.');
            job.status = JobStatus.PAUSED;
            recordHistory(job, step, `Upscale completed via Fal proxy (${factor}x).`);
            await saveAndEmitStep(job, step);
            return { message: 'Upscale completed', step_id: step.id };
        } catch (error) {
            step.status = StepStatus.FAILED;
            step.updated_at = nowIso();
            step.logs.unshift(error instanceof Error ? error.message : 'Upscale failed.');
            job.status = JobStatus.PAUSED;
            await saveAndEmitStep(job, step);
            throw error;
        }
    },

    async trimAlphaAsset(jobId: string, assetId: string): Promise<{ message: string; asset_id: string }> {
        const job = await loadJobOrThrow(jobId);
        const blob = await sourceBlob(job, assetId);
        const asset = await saveBlobAsset(job, blob, AssetKind.GENERATION, 'trimmed.png');
        await saveAndEmitJob(job);
        return { message: 'Trimmed asset created', asset_id: asset.id };
    },

    async plateAndRetry(jobId: string, stepId: string, _removePrompt: string, retryPrompt: string) {
        return this.retryStep(jobId, stepId, retryPrompt);
    },

    async acceptStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        step.status = StepStatus.SUCCESS;
        step.actions_available = ['RETRY'];
        step.logs.unshift('Accepted as final output.');
        job.status = job.steps.every((item) => item.id === stepId ? true : item.status === StepStatus.SUCCESS) ? JobStatus.DONE : JobStatus.PAUSED;
        await saveAndEmitStep(job, step);
        return { message: 'Step accepted' };
    },

    getAssetUrl(jobId: string, assetId: string) {
        const url = ASSET_URL_CACHE.get(assetId);
        if (url) return url;
        const job = JOB_CACHE.get(jobId);
        const asset = job?.assets[assetId];
        return asset?.path || '';
    },

    async stopStep(jobId: string, stepId: string): Promise<{ message: string }> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        step.status = StepStatus.CANCELLED;
        step.logs.unshift('Cancelled in browser runtime.');
        await saveAndEmitStep(job, step);
        return { message: 'Step cancelled' };
    },

    async replaceStepImage(jobId: string, stepId: string, file: File, _target: 'input' | 'output' = 'output'): Promise<any> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        const asset = await saveBlobAsset(job, file, AssetKind.GENERATION, file.name, step.id);
        step.output_asset_id = asset.id;
        step.outputs_history.push(asset.id);
        step.status = StepStatus.NEEDS_REVIEW;
        step.logs.unshift(`Replaced output with ${file.name}.`);
        await saveAndEmitStep(job, step);
        return { message: 'Step image replaced', asset_id: asset.id };
    },

    async uploadMask(jobId: string, file: File): Promise<{ asset_id: string; width: number; height: number }> {
        const job = await loadJobOrThrow(jobId);
        const asset = await saveBlobAsset(job, file, AssetKind.MASK, file.name);
        await saveAndEmitJob(job);
        return { asset_id: asset.id, width: asset.width || 0, height: asset.height || 0 };
    },

    async patchStep(jobId: string, stepId: string, patch: Partial<Step>): Promise<any> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        Object.assign(step, patch);
        step.updated_at = nowIso();
        await saveAndEmitStep(job, step);
        return step;
    },

    async deleteJob(jobId: string): Promise<{ message: string }> {
        const stored = await dbGet<PersistedJob>(JOB_STORE, jobStoreKey(jobId));
        if (stored) {
            await Promise.all(Object.keys(stored.assets).map((assetId) => dbDelete(ASSET_STORE, assetStoreKey(assetId))));
        }
        await dbDelete(JOB_STORE, jobStoreKey(jobId));
        JOB_CACHE.delete(jobId);
        emit('job.updated', null);
        return { message: 'Job deleted' };
    },

    async pauseAllJobs(): Promise<{ message: string }> {
        const jobs = await this.listJobs();
        for (const job of jobs) {
            if (job.status === JobStatus.RUNNING) {
                job.status = JobStatus.PAUSED;
                await saveAndEmitJob(job);
            }
        }
        return { message: 'Paused all jobs' };
    },

    async getPromptVariations(_jobId: string, _stepId: string, _provider: string, _modelConfig: Record<string, any>, _headers: Record<string, string> = {}): Promise<{ variations: string[] }> {
        return {
            variations: [
                'Tighter isolation, preserve exact framing and silhouette.',
                'Conservative extraction with minimal edits beyond the target.',
                'Clean compositing-friendly pass with no new visual elements.',
            ],
        };
    },

    getExportUrl(jobId: string) {
        const cached = EXPORT_CACHE.get(jobId);
        if (cached) return cached;
        const job = JOB_CACHE.get(jobId);
        const payload = JSON.stringify(job || { jobId, message: 'Export becomes available after loading the job.' }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        EXPORT_CACHE.set(jobId, url);
        return url;
    },

    async openInFinder(_jobId: string): Promise<{ ok: boolean; path: string }> {
        const settings = getSettings();
        if (settings.storageMode !== 'local-folder') {
            throw new Error('Open in Finder is only available in local folder mode.');
        }
        const folderName = settings.storageFolderName || 'Selected folder';
        return { ok: true, path: folderName };
    },

    async getStepHistory(jobId: string, stepId: string): Promise<{ history: StepHistoryEntry[] }> {
        const job = await loadJobOrThrow(jobId);
        const history = (job.metadata?._local_history?.[stepId] || []) as StepHistoryEntry[];
        return { history };
    },

    async setActiveOutput(jobId: string, stepId: string, assetId: string): Promise<{ ok: boolean }> {
        const job = await loadJobOrThrow(jobId);
        const step = job.steps.find((item) => item.id === stepId);
        if (!step) throw new Error('Step not found');
        step.output_asset_id = assetId;
        step.updated_at = nowIso();
        await saveAndEmitStep(job, step);
        return { ok: true };
    }
};
