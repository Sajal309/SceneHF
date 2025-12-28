import React, { createContext, useContext, useState, useEffect } from 'react';

// Models
export interface SettingsState {
    apiKey: string;
    provider: 'gemini' | 'openai';
    model: string;
    temperature: number;

    // Image generation settings
    imageProvider: 'vertex' | 'openai';
    imageModel: string;
    imageApiKey: string;
    imageQuality: 'low' | 'medium' | 'high';
}

const DEFAULT_SETTINGS: SettingsState = {
    apiKey: '',
    provider: 'gemini',
    model: 'gemini-2.0-flash-exp',
    temperature: 0.7,

    // Image defaults
    imageProvider: 'openai',
    imageModel: 'gpt-image-1.5',
    imageApiKey: '',
    imageQuality: 'low',
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

                // Sanitize quality to avoid legacy versions
                let imageQuality = parsed.imageQuality || DEFAULT_SETTINGS.imageQuality;
                if (imageQuality === 'standard') imageQuality = 'low';
                else if (imageQuality === 'hd') imageQuality = 'high';

                setSettings({
                    ...DEFAULT_SETTINGS,
                    ...parsed,
                    imageModel,
                    imageQuality
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
    return headers;
}
