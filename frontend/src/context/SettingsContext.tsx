import React, { createContext, useContext, useEffect, useState } from 'react';

export interface ParamValue {
    value: string | number | boolean;
    enabled: boolean;
}

export type StorageMode = 'browser' | 'local-folder' | null;

export interface SettingsState {
    apiKey: string;
    provider: 'gemini' | 'openai';
    model: string;
    llmParams: Record<string, ParamValue>;
    imageParams: Record<string, ParamValue>;
    imageProvider: 'vertex' | 'openai' | 'google';
    imageModel: string;
    imageApiKey: string;
    falModel: string;
    upscaleModel: string;
    falApiKey: string;
    falProxyUrl: string;
    storageMode: StorageMode;
    storageFolderName: string | null;
}

const SETTINGS_STORAGE_KEY = 'scenehf_settings';
const SESSION_STORAGE_KEY = 'scenehf_session_storage';

const DEFAULT_SETTINGS: SettingsState = {
    apiKey: '',
    provider: 'openai',
    model: 'gpt-4o',
    llmParams: {
        temperature: { value: 0.7, enabled: false },
    },
    imageParams: {
        quality: { value: 'low', enabled: false },
    },
    imageProvider: 'openai',
    imageModel: 'gpt-image-1.5',
    imageApiKey: '',
    falModel: 'fal-ai/imageutils/rembg',
    upscaleModel: 'fal-ai/imageutils/upscale',
    falApiKey: '',
    falProxyUrl: 'https://scenehf-fal-proxy.sajalrai96309.workers.dev',
    storageMode: null,
    storageFolderName: null,
};

interface SettingsContextType {
    settings: SettingsState;
    updateSettings: (newSettings: Partial<SettingsState>) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);

    useEffect(() => {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const savedSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
        try {
            const parsed = saved ? JSON.parse(saved) : {};
            const parsedSession = savedSession ? JSON.parse(savedSession) : {};
            let imageModel = parsed.imageModel || DEFAULT_SETTINGS.imageModel;
            if (imageModel.startsWith('gpt-image-1.5')) imageModel = 'gpt-image-1.5';
            else if (imageModel.startsWith('gpt-image-1-mini')) imageModel = 'gpt-image-1-mini';
            else if (imageModel.startsWith('gpt-image-1') && !imageModel.includes('mini')) imageModel = 'gpt-image-1';
            const falProxyUrl = typeof parsed.falProxyUrl === 'string' && parsed.falProxyUrl.trim()
                ? parsed.falProxyUrl
                : DEFAULT_SETTINGS.falProxyUrl;

            setSettings({
                ...DEFAULT_SETTINGS,
                ...parsed,
                storageMode: parsedSession.storageMode ?? DEFAULT_SETTINGS.storageMode,
                storageFolderName: parsedSession.storageFolderName ?? DEFAULT_SETTINGS.storageFolderName,
                falProxyUrl,
                imageModel,
                llmParams: parsed.llmParams || {
                    temperature: { value: parsed.temperature ?? 0.7, enabled: false },
                },
                imageParams: parsed.imageParams || {
                    quality: { value: parsed.imageQuality ?? 'low', enabled: false },
                },
            });
        } catch (error) {
            console.error('Failed to parse settings', error);
        }
    }, []);

    const updateSettings = (newSettings: Partial<SettingsState>) => {
        setSettings((prev) => {
            const next = { ...prev, ...newSettings };
            const { storageMode, storageFolderName, ...persistentSettings } = next;
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistentSettings));
            if (storageMode) {
                sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
                    storageMode,
                    storageFolderName,
                }));
            } else {
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
            }
            return next;
        });
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}

export function getApiHeaders(settings: SettingsState) {
    const headers: Record<string, string> = {};
    if (settings.apiKey) {
        if (settings.provider === 'gemini') {
            headers['X-Google-Api-Key'] = settings.apiKey;
        } else if (settings.provider === 'openai') {
            headers['X-Openai-Api-Key'] = settings.apiKey;
        }
    }
    if (settings.imageApiKey) {
        headers['X-Image-Api-Key'] = settings.imageApiKey;
    }
    if (settings.falApiKey) {
        headers['X-Fal-Api-Key'] = settings.falApiKey;
    }
    return headers;
}
