import { useEffect, useState } from 'react';
import { runtimeEvents } from './api';

export interface SSEEvent {
    type: string;
    data: any;
}

export type SSECallback = (event: SSEEvent) => void;

export class SSEClient {
    private unsubscribe: (() => void) | null = null;

    connect() {
        this.unsubscribe = runtimeEvents.subscribe((event) => {
            this.callbacks.forEach((callback) => callback(event));
        });
    }

    disconnect() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private callbacks: SSECallback[] = [];

    on(callback: SSECallback) {
        this.callbacks.push(callback);
    }

    off(callback: SSECallback) {
        this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    }
}

export function useJobSSE(jobId: string | null, callbacks: {
    onJobUpdate?: (job: any) => void;
    onStepUpdate?: (step: any) => void;
    onLog?: (log: any) => void;
}) {
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!jobId) {
            setIsConnected(false);
            return;
        }

        const client = new SSEClient();
        client.on((event) => {
            if (event.type === 'job.updated' && callbacks.onJobUpdate) {
                callbacks.onJobUpdate(event.data);
            } else if (event.type === 'step.updated' && callbacks.onStepUpdate) {
                callbacks.onStepUpdate(event.data);
            } else if (event.type === 'log' && callbacks.onLog) {
                callbacks.onLog(event.data);
            }
        });
        client.connect();
        setIsConnected(true);

        return () => {
            client.disconnect();
            setIsConnected(false);
        };
    }, [jobId, callbacks.onJobUpdate, callbacks.onStepUpdate, callbacks.onLog]);

    return { isConnected };
}
