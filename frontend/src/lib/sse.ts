import { useEffect, useRef, useState } from 'react';

export interface SSEEvent {
    type: string;
    data: any;
}

export type SSECallback = (event: SSEEvent) => void;

export class SSEClient {
    private eventSource: EventSource | null = null;
    private callbacks: SSECallback[] = [];

    connect(jobId: string) {
        this.disconnect();

        const url = `/api/jobs/${jobId}/events`;
        this.eventSource = new EventSource(url);

        // Listen for all event types
        ['job.updated', 'step.updated', 'log'].forEach(eventType => {
            this.eventSource!.addEventListener(eventType, (e: MessageEvent) => {
                const data = JSON.parse(e.data);
                this.emit({ type: eventType, data });
            });
        });

        this.eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            // Auto-reconnect after 3 seconds
            setTimeout(() => {
                if (this.eventSource?.readyState === EventSource.CLOSED) {
                    this.connect(jobId);
                }
            }, 3000);
        };
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
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
