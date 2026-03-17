import type { BrowserPlan, BrowserStep, PlanRequest, PlanningProvider, ProviderCapability } from './types';

export const PROVIDER_CAPABILITIES: Record<PlanningProvider, ProviderCapability> = {
    local: {
        planning: true,
        imageGeneration: false,
        localFolder: true,
        note: 'Built-in planning only. Image generation stays manual in this branch.',
    },
    openai: {
        planning: true,
        imageGeneration: false,
        localFolder: true,
        note: 'Uses a browser-side API key for planning only. Image generation is not enabled in this branch.',
    },
    gemini: {
        planning: true,
        imageGeneration: false,
        localFolder: true,
        note: 'Uses a browser-side API key for planning only. Image generation is not enabled in this branch.',
    },
};

function buildSteps(layerNames: string[], sceneDescription: string): BrowserStep[] {
    return layerNames.map((layerName, index) => ({
        id: `s${index + 1}`,
        index,
        name: `Extract ${layerName}`,
        type: 'EXTRACT',
        status: 'QUEUED',
        target: layerName,
        prompt: `Isolate ${layerName} from the source scene. Preserve framing and lighting. Keep the result production-ready for later compositing. Scene notes: ${sceneDescription || 'No extra scene notes provided.'}`,
        outputsHistory: [],
        logs: [],
    }));
}

export function createLocalPlan(request: PlanRequest): BrowserPlan {
    const names = request.layerNames
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, request.layerCount);
    const layerNames = names.length > 0
        ? names
        : Array.from({ length: request.layerCount }, (_, index) => {
            if (index === 0) return 'Foreground elements';
            if (index === request.layerCount - 1) return 'Background plate';
            return `Layer ${index + 1}`;
        });

    return {
        sceneSummary: request.sceneDescription || 'User uploaded a source scene and requested a browser-local planning flow.',
        globalRules: [
            'All job data is handled inside the browser runtime for this branch.',
            'Generated assets are attached manually or produced by external tools and then stored locally.',
            'The browser planner keeps layer prompts conservative and compositing-friendly.',
        ],
        steps: buildSteps(layerNames, request.sceneDescription),
    };
}

function extractJson(text: string) {
    const fenced = text.match(/```json\s*([\s\S]+?)```/i);
    if (fenced?.[1]) return fenced[1];
    return text;
}

async function requestOpenAiPlan(apiKey: string, request: PlanRequest): Promise<BrowserPlan> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'Return valid JSON with keys sceneSummary, globalRules, and steps. steps must be an array of { target, prompt }. Keep prompts short and compositing-focused.',
                },
                {
                    role: 'user',
                    content: `Scene description: ${request.sceneDescription || 'No scene description provided.'}\nLayer count: ${request.layerCount}\nPreferred layers: ${request.layerNames.filter(Boolean).join(', ') || 'auto'}\nBuild a practical layer extraction plan for a browser-local workflow where users may upload outputs manually.`,
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI planning failed (${response.status})`);
    }

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (!raw) {
        throw new Error('OpenAI planning returned no content.');
    }
    const parsed = JSON.parse(extractJson(raw));
    return {
        sceneSummary: String(parsed.sceneSummary || request.sceneDescription || 'Planned with OpenAI'),
        globalRules: Array.isArray(parsed.globalRules) ? parsed.globalRules.map(String) : [],
        steps: buildSteps(
            Array.isArray(parsed.steps) ? parsed.steps.map((step: { target?: string; }) => String(step.target || 'Layer')) : request.layerNames,
            request.sceneDescription,
        ).map((step, index) => ({
            ...step,
            prompt: Array.isArray(parsed.steps) && parsed.steps[index]?.prompt
                ? String(parsed.steps[index].prompt)
                : step.prompt,
        })),
    };
}

async function requestGeminiPlan(apiKey: string, request: PlanRequest): Promise<BrowserPlan> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: `Return JSON only with keys sceneSummary, globalRules, and steps. Each step should include target and prompt. Scene description: ${request.sceneDescription || 'No description provided.'}. Layer count: ${request.layerCount}. Preferred layers: ${request.layerNames.filter(Boolean).join(', ') || 'auto'}.`,
                }],
            }],
            generationConfig: {
                temperature: 0.3,
                responseMimeType: 'application/json',
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemini planning failed (${response.status})`);
    }

    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
        throw new Error('Gemini planning returned no content.');
    }
    const parsed = JSON.parse(extractJson(raw));
    return {
        sceneSummary: String(parsed.sceneSummary || request.sceneDescription || 'Planned with Gemini'),
        globalRules: Array.isArray(parsed.globalRules) ? parsed.globalRules.map(String) : [],
        steps: buildSteps(
            Array.isArray(parsed.steps) ? parsed.steps.map((step: { target?: string; }) => String(step.target || 'Layer')) : request.layerNames,
            request.sceneDescription,
        ).map((step, index) => ({
            ...step,
            prompt: Array.isArray(parsed.steps) && parsed.steps[index]?.prompt
                ? String(parsed.steps[index].prompt)
                : step.prompt,
        })),
    };
}

export async function generatePlan(provider: PlanningProvider, apiKey: string, request: PlanRequest): Promise<BrowserPlan> {
    if (provider === 'openai' && apiKey) {
        return requestOpenAiPlan(apiKey, request);
    }
    if (provider === 'gemini' && apiKey) {
        return requestGeminiPlan(apiKey, request);
    }
    return createLocalPlan(request);
}
