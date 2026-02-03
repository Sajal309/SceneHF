import { useEffect, useRef, useState } from 'react';

export interface SSEEvent {
    type: string;
    data: any;
}

export type SSECallback = (event: SSEEvent) => void;

export class SSEClient {
    private eventSource: EventSource | null = null;
    private callbacks: SSECallback[] = [];
    private reconnectTimer: number | null = null;
    private activeJobId: string | null = null;

    connect(jobId: string) {
        this.activeJobId = jobId;
        this.clearReconnectTimer();
        this.disconnect();

        const url = `/api/jobs/${jobId}/events`;
        this.eventSource = new EventSource(url);

        // Listen for all event types
        ['job.updated', 'step.updated', 'log'].forEach(eventType => {
            this.eventSource!.addEventListener(eventType, (e: MessageEvent) => {
                try {
                    const data = JSON.parse(e.data);
                    this.emit({ type: eventType, data });
                } catch (err) {
                    console.error('Failed to parse SSE payload:', err);
                }
            });
        });

        this.eventSource.onopen = () => {
            this.clearReconnectTimer();
        };

        this.eventSource.onerror = (error) => {
            console.warn('SSE disconnected, reconnecting...', error);
            // Force a clean reconnect because readyState checks are unreliable across browsers.
            this.disconnect();
            this.reconnectTimer = window.setTimeout(() => {
                if (this.activeJobId) {
                    this.connect(this.activeJobId);
                }
            }, 1500);
        };
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.clearReconnectTimer();
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    on(callback: SSECallback) {
        this.callbacks.push(callback);
    }

    off(callback: SSECallback) {
        this.callbacks = this.callbacks.filter(cb => cb !== callback);
    }

    private emit(event: SSEEvent) {
        this.callbacks.forEach(cb => cb(event));
    }
}

export function useJobSSE(jobId: string | null, callbacks: {
    onJobUpdate?: (job: any) => void;
    onStepUpdate?: (step: any) => void;
    onLog?: (log: any) => void;
}) {
    const [isConnected, setIsConnected] = useState(false);
    const clientRef = useRef<SSEClient | null>(null);

    // Keep callbacks fresh in ref to avoid re-connecting when they change
    const callbacksRef = useRef(callbacks);
    useEffect(() => {
        callbacksRef.current = callbacks;
    }, [callbacks.onJobUpdate, callbacks.onStepUpdate, callbacks.onLog]);

    useEffect(() => {
        if (!jobId) {
            setIsConnected(false);
            return;
        }

        const client = new SSEClient();
        clientRef.current = client;

        client.on((event) => {
            const cbs = callbacksRef.current;
            if (event.type === 'job.updated' && cbs.onJobUpdate) {
                cbs.onJobUpdate(event.data);
            } else if (event.type === 'step.updated' && cbs.onStepUpdate) {
                cbs.onStepUpdate(event.data);
            } else if (event.type === 'log' && cbs.onLog) {
                cbs.onLog(event.data);
            }
        });

        client.connect(jobId);
        setIsConnected(true);

        return () => {
            client.disconnect();
            setIsConnected(false);
        };
    }, [jobId]);

    return { isConnected };
}
