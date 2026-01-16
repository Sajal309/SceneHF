import { useState } from 'react';
import { useSettings, ParamValue } from '../../context/SettingsContext';
import { GearIcon, PersonIcon, MixIcon, PlusIcon, TrashIcon, CheckboxIcon, SquareIcon, ChevronDownIcon, ChevronRightIcon, ImageIcon } from '@radix-ui/react-icons';

interface ParamListProps {
    title: string;
    params: Record<string, ParamValue>;
    onUpdate: (key: string, value: Partial<ParamValue>) => void;
    onAdd: (key: string) => void;
    onDelete: (key: string) => void;
}

function ParamList({ title, params, onUpdate, onAdd, onDelete }: ParamListProps) {
    const [newKey, setNewKey] = useState('');

    return (
        <div className="space-y-2 mt-3">
            <h4 className="text-[10px] font-bold text-[var(--text-subtle)] uppercase tracking-widest">{title}</h4>
            <div className="space-y-2">
                {Object.entries(params).map(([key, data]) => (
                    <div key={key} className="flex items-center gap-2 group">
                        <button
                            onClick={() => onUpdate(key, { enabled: !data.enabled })}
                            className={`p-1 rounded transition-colors ${data.enabled ? 'text-[var(--accent)] bg-[var(--accent-soft)]' : 'text-[var(--text-subtle)] hover:bg-[var(--panel-contrast)]'}`}
                        >
                            {data.enabled ? <CheckboxIcon /> : <SquareIcon />}
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-[var(--text-subtle)] font-mono truncate">{key}</div>
                            <input
                                type="text"
                                className="w-full bg-transparent border-b border-[var(--border)] focus:border-[var(--accent)] outline-none text-xs py-0.5 text-[var(--text)]"
                                value={String(data.value)}
                                onChange={(e) => onUpdate(key, { value: e.target.value })}
                            />
                        </div>
                        <button
                            onClick={() => onDelete(key)}
                            className="p-1 text-[var(--text-subtle)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all"
                        >
                            <TrashIcon />
                        </button>
                    </div>
                ))}
            </div>
            <div className="flex gap-2 mt-2 pt-2 border-t border-[var(--border)]">
                <input
                    type="text"
                    placeholder="New param..."
                    className="flex-1 bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && newKey) {
                            onAdd(newKey);
                            setNewKey('');
                        }
                    }}
                />
                <button
                    onClick={() => {
                        if (newKey) {
                            onAdd(newKey);
                            setNewKey('');
                        }
                    }}
                    className="p-1.5 bg-[var(--panel-contrast)] hover:bg-[var(--border)] rounded transition-colors text-[var(--text-subtle)]"
                >
                    <PlusIcon />
                </button>
            </div>
        </div>
    );
}

interface CollapsibleSectionProps {
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

function CollapsibleSection({ title, icon, defaultOpen = true, children }: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className="glass-card rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--panel-contrast)] transition-colors"
            >
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    {icon}
                    <span>{title}</span>
                </div>
                {isOpen ? <ChevronDownIcon className="text-[var(--text-subtle)]" /> : <ChevronRightIcon className="text-[var(--text-subtle)]" />}
            </button>
            {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)]">
                    {children}
                </div>
            )}
        </section>
    );
}

export function SettingsPanel() {
    const { settings, updateSettings } = useSettings();

    const handleParamUpdate = (type: 'llm' | 'image', key: string, value: Partial<ParamValue>) => {
        const field = type === 'llm' ? 'llmParams' : 'imageParams';
        updateSettings({
            [field]: {
                ...settings[field],
                [key]: { ...settings[field][key], ...value }
            }
        });
    };

    const handleParamAdd = (type: 'llm' | 'image', key: string) => {
        const field = type === 'llm' ? 'llmParams' : 'imageParams';
        if (settings[field][key]) return;
        updateSettings({
            [field]: {
                ...settings[field],
                [key]: { value: '', enabled: true }
            }
        });
    };

    const handleParamDelete = (type: 'llm' | 'image', key: string) => {
        const field = type === 'llm' ? 'llmParams' : 'imageParams';
        const newParams = { ...settings[field] };
        delete newParams[key];
        updateSettings({ [field]: newParams });
    };

    return (
        <div className="h-full flex flex-col p-4 glass-panel border-r border-[var(--border)] w-80 text-[var(--text)] overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-center gap-2 text-[var(--text)] font-semibold text-lg mb-6">
                <MixIcon className="w-6 h-6 text-[var(--accent)]" />
                <span>SceneHF</span>
            </div>

            <div className="space-y-4 flex-1">
                {/* LLM Configuration */}
                <CollapsibleSection title="Text Model (LLM)" icon={<GearIcon className="w-4 h-4 text-indigo-400" />}>
                    <div className="space-y-3 mt-3">
                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">Provider</label>
                            <select
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none"
                                value={settings.provider}
                                onChange={(e) => updateSettings({ provider: e.target.value as any })}
                            >
                                <option value="gemini">Google Gemini</option>
                                <option value="openai">OpenAI</option>
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">Model</label>
                            <input
                                type="text"
                                list="model-options"
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none"
                                value={settings.model}
                                onChange={(e) => updateSettings({ model: e.target.value })}
                                placeholder="e.g. gpt-4o"
                            />
                            <datalist id="model-options">
                                <option value="gemini-2.0-flash-exp" />
                                <option value="gemini-1.5-flash" />
                                <option value="gemini-1.5-pro" />
                                <option value="gpt-4o" />
                                <option value="gpt-4o-mini" />
                                <option value="o1" />
                            </datalist>
                        </div>

                        <ParamList
                            title="Parameters"
                            params={settings.llmParams}
                            onUpdate={(k, v) => handleParamUpdate('llm', k, v)}
                            onAdd={(k) => handleParamAdd('llm', k)}
                            onDelete={(k) => handleParamDelete('llm', k)}
                        />
                    </div>
                </CollapsibleSection>

                {/* Image Generation Configuration */}
                <CollapsibleSection title="Image Model" icon={<ImageIcon className="w-4 h-4 text-[var(--accent)]" />}>
                    <div className="space-y-3 mt-3">
                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">Provider</label>
                            <select
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none"
                                value={settings.imageProvider}
                                onChange={(e) => updateSettings({ imageProvider: e.target.value as any })}
                            >
                                <option value="vertex">Vertex AI (Imagen)</option>
                                <option value="openai">OpenAI (DALL-E)</option>
                                <option value="google">Google (Gemini Image)</option>
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">Model</label>
                            <input
                                type="text"
                                list="image-model-options"
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none"
                                value={settings.imageModel}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    const updates: any = { imageModel: val };
                                    if (val.toLowerCase().includes('gemini') || val.toLowerCase().includes('nano')) {
                                        updates.imageProvider = 'google';
                                    } else if (val.toLowerCase().includes('gpt-image') || val.toLowerCase().includes('dall-e')) {
                                        updates.imageProvider = 'openai';
                                    } else if (val.toLowerCase().includes('imagegeneration@')) {
                                        updates.imageProvider = 'vertex';
                                    }
                                    updateSettings(updates);
                                }}
                                placeholder="e.g. gpt-image-1.5"
                            />
                            <datalist id="image-model-options">
                                <option value="gpt-image-1.5" />
                                <option value="gemini-2.5-flash-image" />
                                <option value="dall-e-3" />
                                <option value="chatgpt-image-latest" />
                            </datalist>
                        </div>

                        <ParamList
                            title="Parameters"
                            params={settings.imageParams}
                            onUpdate={(k, v) => handleParamUpdate('image', k, v)}
                            onAdd={(k) => handleParamAdd('image', k)}
                            onDelete={(k) => handleParamDelete('image', k)}
                        />
                    </div>
                </CollapsibleSection>

                {/* API Keys */}
                <CollapsibleSection title="API Credentials" icon={<PersonIcon className="w-4 h-4 text-[var(--accent)]" />}>
                    <div className="space-y-3 mt-3">
                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">
                                {settings.provider === 'gemini' ? 'Google AI Key' : 'OpenAI Key'}
                            </label>
                            <input
                                type="password"
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none font-mono"
                                value={settings.apiKey}
                                onChange={(e) => updateSettings({ apiKey: e.target.value })}
                                placeholder="sk-..."
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-[11px] font-bold text-[var(--text-subtle)] uppercase">Image API Key</label>
                            <input
                                type="password"
                                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-1.5 text-sm focus:border-[var(--accent)] outline-none font-mono"
                                value={settings.imageApiKey}
                                onChange={(e) => updateSettings({ imageApiKey: e.target.value })}
                                placeholder="sk-..."
                            />
                        </div>
                    </div>
                </CollapsibleSection>
            </div>

            {/* Footer */}
            <div className="mt-6 px-2 py-4 border-t border-[var(--border)]">
                <div className="text-[10px] text-[var(--text-subtle)] font-medium tracking-widest text-center uppercase">
                    v2.0.0 Modern Edition
                </div>
            </div>
        </div>
    );
}
