import React from 'react';
import { useSettings } from '../../context/SettingsContext';
import { GearIcon, PersonIcon, MixIcon } from '@radix-ui/react-icons';

export function SettingsPanel() {
    const { settings, updateSettings } = useSettings();

    return (
        <div className="h-full flex flex-col p-4 bg-gray-900 border-r border-gray-800 w-80 text-gray-300 gap-6 overflow-y-auto">
            <div className="flex items-center gap-2 text-white font-bold text-lg mb-2">
                <MixIcon className="w-6 h-6 text-indigo-500" />
                <span>SceneHF</span>
            </div>

            {/* Provider & Model */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <GearIcon /> Model Config
                </h3>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Provider</label>
                    <select
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none"
                        value={settings.provider}
                        onChange={(e) => updateSettings({ provider: e.target.value as any })}
                    >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Model</label>
                    <input
                        type="text"
                        list="model-options"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none"
                        value={settings.model}
                        onChange={(e) => updateSettings({ model: e.target.value })}
                        placeholder="e.g. gpt-5-mini"
                    />
                    <datalist id="model-options">
                        <option value="gemini-2.0-flash-exp" />
                        <option value="gemini-1.5-flash" />
                        <option value="gemini-1.5-pro" />
                        <option value="gpt-4o" />
                        <option value="gpt-4o-mini" />
                        <option value="o1" />
                        <option value="gpt-5-mini" />
                    </datalist>
                </div>

                <div className="space-y-1">
                    <div className="flex justify-between">
                        <label className="text-sm font-medium">Temperature</label>
                        <span className="text-xs text-gray-500">{settings.temperature}</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        className="w-full"
                        value={settings.temperature}
                        onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
                    />
                </div>
            </section>

            {/* API Keys */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <PersonIcon /> API Credentials
                </h3>

                <div className="p-3 bg-yellow-900/20 border border-yellow-800/30 rounded text-xs text-yellow-500 leading-relaxed">
                    Keys are stored locally in your browser.
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">
                        {settings.provider === 'gemini' ? 'Google AI Key' : 'OpenAI Key'}
                    </label>
                    <input
                        type="password"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none font-mono"
                        value={settings.apiKey}
                        onChange={(e) => updateSettings({ apiKey: e.target.value })}
                        placeholder="sk-..."
                    />
                </div>
            </section>

            {/* Image Generation Settings */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <MixIcon /> Image Generation
                </h3>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Image Provider</label>
                    <select
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none"
                        value={settings.imageProvider}
                        onChange={(e) => updateSettings({ imageProvider: e.target.value as any })}
                    >
                        <option value="vertex">Vertex AI (Imagen)</option>
                        <option value="openai">OpenAI (DALL-E)</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Image Model</label>
                    <input
                        type="text"
                        list="image-model-options"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none"
                        value={settings.imageModel}
                        onChange={(e) => updateSettings({ imageModel: e.target.value })}
                        placeholder="e.g. dall-e-3"
                    />
                    <datalist id="image-model-options">
                        <option value="gpt-image-1.5" />
                        <option value="gpt-image-1" />
                        <option value="gpt-image-1-mini" />
                        <option value="chatgpt-image-latest" />
                        <option value="dall-e-3" />
                    </datalist>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Image API Key</label>
                    <input
                        type="password"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none font-mono"
                        value={settings.imageApiKey}
                        onChange={(e) => updateSettings({ imageApiKey: e.target.value })}
                        placeholder="sk-..."
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">Quality</label>
                    <select
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-indigo-500 outline-none"
                        value={settings.imageQuality}
                        onChange={(e) => updateSettings({ imageQuality: e.target.value as any })}
                    >
                        <option value="low">Low (Faster)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (Best quality)</option>
                    </select>
                </div>


            </section>

            <div className="mt-auto text-xs text-gray-600 text-center">
                v1.0.0 SaaS Edition
            </div>
        </div>
    );
}
