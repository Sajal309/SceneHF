import type { BrowserAsset, BrowserAssetKind, BrowserJob } from './types';

const DB_NAME = 'scenehf-browser';
const STORE_NAME = 'kv';
const ROOT_HANDLE_KEY = 'local-folder-root-handle';

type MemoryRecord = {
    job: BrowserJob;
    assets: Map<string, Blob>;
};

const memoryStore = new Map<string, MemoryRecord>();

function nowIso() {
    return new Date().toISOString();
}

function randomId(prefix: string) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeSegment(value: string) {
    return value.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'asset';
}

function extensionFromMime(mimeType: string) {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    return 'bin';
}

function assetSubdir(kind: BrowserAssetKind) {
    if (kind === 'SOURCE') return 'source';
    if (kind === 'MASK') return 'masks';
    if (kind === 'DERIVED') return 'derived';
    return 'generations';
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbGet<T>(key: string): Promise<T | null> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function idbSet<T>(key: string, value: T) {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbDelete(key: string) {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function ensureDirectory(parent: FileSystemDirectoryHandle, name: string) {
    return parent.getDirectoryHandle(name, { create: true });
}

async function writeJsonFile(parent: FileSystemDirectoryHandle, filename: string, data: unknown) {
    const handle = await parent.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
}

async function readJsonFile<T>(parent: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
    try {
        const handle = await parent.getFileHandle(filename);
        const file = await handle.getFile();
        return JSON.parse(await file.text()) as T;
    } catch {
        return null;
    }
}

async function queryPermission(handle: FileSystemHandle, mode: FileSystemPermissionMode = 'readwrite') {
    const state = await handle.queryPermission({ mode });
    if (state === 'granted') return true;
    const requested = await handle.requestPermission({ mode });
    return requested === 'granted';
}

async function describeRoot(handle: FileSystemDirectoryHandle | null) {
    if (!handle) return null;
    return handle.name || 'Selected folder';
}

export interface StorageAdapter {
    mode: 'memory' | 'local-folder';
    supported: boolean;
    listJobs(): Promise<BrowserJob[]>;
    loadJob(jobId: string): Promise<BrowserJob | null>;
    saveJob(job: BrowserJob): Promise<void>;
    deleteJob(jobId: string): Promise<void>;
    saveAsset(jobId: string, input: {
        blob: Blob;
        kind: BrowserAssetKind;
        name: string;
        stepId?: string;
    }): Promise<BrowserAsset>;
    readAsset(jobId: string, asset: BrowserAsset): Promise<Blob | null>;
    chooseRootFolder?(): Promise<string | null>;
    reconnectRootFolder?(): Promise<boolean>;
    disconnectRootFolder?(): Promise<void>;
    describeConnection(): Promise<string | null>;
}

export class MemoryStorageAdapter implements StorageAdapter {
    mode = 'memory' as const;
    supported = true;

    async listJobs() {
        return Array.from(memoryStore.values())
            .map((record) => record.job)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async loadJob(jobId: string) {
        return memoryStore.get(jobId)?.job ?? null;
    }

    async saveJob(job: BrowserJob) {
        const existing = memoryStore.get(job.id);
        memoryStore.set(job.id, {
            job: { ...job, updatedAt: nowIso() },
            assets: existing?.assets ?? new Map<string, Blob>(),
        });
    }

    async deleteJob(jobId: string) {
        memoryStore.delete(jobId);
    }

    async saveAsset(jobId: string, input: { blob: Blob; kind: BrowserAssetKind; name: string; stepId?: string; }) {
        const record = memoryStore.get(jobId);
        if (!record) {
            throw new Error('Job not found in memory storage.');
        }
        const id = randomId('asset');
        const asset: BrowserAsset = {
            id,
            kind: input.kind,
            name: input.name,
            path: `${assetSubdir(input.kind)}/${id}.${extensionFromMime(input.blob.type || 'application/octet-stream')}`,
            mimeType: input.blob.type || 'application/octet-stream',
            size: input.blob.size,
            createdAt: nowIso(),
            stepId: input.stepId,
        };
        record.assets.set(id, input.blob);
        record.job.assets[id] = asset;
        record.job.updatedAt = nowIso();
        return asset;
    }

    async readAsset(jobId: string, asset: BrowserAsset) {
        return memoryStore.get(jobId)?.assets.get(asset.id) ?? null;
    }

    async describeConnection() {
        return 'Ephemeral browser memory';
    }
}

export class LocalFolderStorageAdapter implements StorageAdapter {
    mode = 'local-folder' as const;
    supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    private rootHandle: FileSystemDirectoryHandle | null = null;

    private async getRootHandle(requireWrite = false) {
        if (this.rootHandle) {
            const ok = await queryPermission(this.rootHandle, requireWrite ? 'readwrite' : 'read');
            if (ok) return this.rootHandle;
        }
        const stored = await idbGet<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
        if (!stored) return null;
        const ok = await queryPermission(stored, requireWrite ? 'readwrite' : 'read');
        if (!ok) return null;
        this.rootHandle = stored;
        return stored;
    }

    async chooseRootFolder() {
        if (!this.supported) {
            throw new Error('Local folder mode requires a browser with File System Access API support.');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const ok = await queryPermission(handle, 'readwrite');
        if (!ok) {
            throw new Error('Folder access was not granted.');
        }
        this.rootHandle = handle;
        await idbSet(ROOT_HANDLE_KEY, handle);
        return describeRoot(handle);
    }

    async reconnectRootFolder() {
        const handle = await this.getRootHandle(true);
        return Boolean(handle);
    }

    async disconnectRootFolder() {
        this.rootHandle = null;
        await idbDelete(ROOT_HANDLE_KEY);
    }

    async describeConnection() {
        const handle = await this.getRootHandle(false);
        return describeRoot(handle);
    }

    private async getJobDir(jobId: string, create = false) {
        const root = await this.getRootHandle(create);
        if (!root) {
            throw new Error('Select a local storage folder first.');
        }
        return root.getDirectoryHandle(jobId, { create });
    }

    async listJobs() {
        const root = await this.getRootHandle(false);
        if (!root) return [];

        const jobs: BrowserJob[] = [];
        for await (const [, handle] of root.entries()) {
            if (handle.kind !== 'directory') continue;
            const job = await readJsonFile<BrowserJob>(handle as FileSystemDirectoryHandle, 'job.json');
            if (job) jobs.push(job);
        }
        jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return jobs;
    }

    async loadJob(jobId: string) {
        try {
            const dir = await this.getJobDir(jobId, false);
            return readJsonFile<BrowserJob>(dir, 'job.json');
        } catch {
            return null;
        }
    }

    async saveJob(job: BrowserJob) {
        const dir = await this.getJobDir(job.id, true);
        await writeJsonFile(dir, 'job.json', { ...job, updatedAt: nowIso() });
    }

    async deleteJob(jobId: string) {
        const root = await this.getRootHandle(true);
        if (!root) return;
        await root.removeEntry(jobId, { recursive: true });
    }

    async saveAsset(jobId: string, input: { blob: Blob; kind: BrowserAssetKind; name: string; stepId?: string; }) {
        const jobDir = await this.getJobDir(jobId, true);
        const assetsDir = await ensureDirectory(jobDir, 'assets');
        const subdir = await ensureDirectory(assetsDir, assetSubdir(input.kind));
        const id = randomId('asset');
        const fileExt = extensionFromMime(input.blob.type || 'application/octet-stream');
        const filename = `${sanitizeSegment(input.name)}_${id}.${fileExt}`;
        const fileHandle = await subdir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(input.blob);
        await writable.close();

        return {
            id,
            kind: input.kind,
            name: input.name,
            path: `assets/${assetSubdir(input.kind)}/${filename}`,
            mimeType: input.blob.type || 'application/octet-stream',
            size: input.blob.size,
            createdAt: nowIso(),
            stepId: input.stepId,
        };
    }

    async readAsset(jobId: string, asset: BrowserAsset) {
        try {
            const jobDir = await this.getJobDir(jobId, false);
            const segments = asset.path.split('/');
            let current: FileSystemDirectoryHandle = jobDir;
            for (const segment of segments.slice(0, -1)) {
                current = await current.getDirectoryHandle(segment);
            }
            const fileHandle = await current.getFileHandle(segments[segments.length - 1]);
            return fileHandle.getFile();
        } catch {
            return null;
        }
    }
}

export function createEmptyJob(name: string, storageMode: BrowserJob['storageMode']): BrowserJob {
    return {
        id: randomId('job'),
        name,
        status: 'IDLE' as const,
        storageMode,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        sourceAssetId: '',
        steps: [],
        assets: {},
        logs: [],
    };
}
