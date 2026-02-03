import React, { createContext, useContext, useState, useEffect } from 'react';

// Models
export interface ParamValue {
    value: string | number | boolean;
    enabled: boolean;
}

export interface SettingsState {
    apiKey: string;
    provider: 'gemini' | 'openai';
    model: string;

    // Dynamic parameters
    llmParams: Record<string, ParamValue>;
    imageParams: Record<string, ParamValue>;

    // Image generation settings
    imageProvider: 'vertex' | 'openai' | 'google';
    imageModel: string;
    imageApiKey: string;
    falModel: string;
    falApiKey: string;
}

const DEFAULT_SETTINGS: SettingsState = {
    apiKey: '',
    provider: 'openai',
    model: 'gpt-4o',

    llmParams: {
        'temperature': { value: 0.7, enabled: false },
    },
    imageParams: {
        'quality': { value: 'low', enabled: false },
    },

    // Image defaults
    imageProvider: 'openai',
    imageModel: 'gpt-image-1.5',
    imageApiKey: '',
    falModel: 'fal-ai/imageutils/rembg',
    falApiKey: '',
};

interface SettingsContextType {
    settings: SettingsState;
    updateSettings: (newSettings: Partial<SettingsState>) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);

    useEffect(() => {
        // Load from local storage
        const saved = localStorage.getItem('scenehf_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);

                // Sanitize model name to avoid dated versions
                let imageModel = parsed.imageModel || DEFAULT_SETTINGS.imageModel;
                if (imageModel.startsWith('gpt-image-1.5')) imageModel = 'gpt-image-1.5';
                else if (imageModel.startsWith('gpt-image-1-mini')) imageModel = 'gpt-image-1-mini';
                else if (imageModel.startsWith('gpt-image-1') && !imageModel.includes('mini')) imageModel = 'gpt-image-1';

                setSettings({
                    ...DEFAULT_SETTINGS,
                    ...parsed,
                    imageModel,
                    // If old settings existed, migrate them to dynamic params if needed
                    llmParams: parsed.llmParams || {
                        'temperature': { value: parsed.temperature ?? 0.7, enabled: false }
                    },
                    imageParams: parsed.imageParams || {
                        'quality': { value: parsed.imageQuality ?? 'low', enabled: false }
                    }
                });
            } catch (e) {
                console.error("Failed to parse settings", e);
            }
        }
    }, []);

    const updateSettings = (newSettings: Partial<SettingsState>) => {
        setSettings(prev => {
            const next = { ...prev, ...newSettings };
            localStorage.setItem('scenehf_settings', JSON.stringify(next));
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

// Helper to get headers for API calls
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
