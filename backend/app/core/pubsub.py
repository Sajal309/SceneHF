import asyncio
from typing import Dict, Set, AsyncGenerator
from collections import defaultdict
import json


class PubSub:
    """In-memory SSE pubsub system for job events."""
    
    def __init__(self):
        # job_id -> set of queues
        self._subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)
    
    async def subscribe(self, job_id: str) -> AsyncGenerator[str, None]:
        """Subscribe to events for a job. Yields SSE-formatted strings."""
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[job_id].add(queue)
        
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            # Cleanup on disconnect
            self._subscribers[job_id].discard(queue)
            if not self._subscribers[job_id]:
                del self._subscribers[job_id]
    
    def emit(self, job_id: str, event_type: str, data: dict) -> None:
        """Emit an event to all subscribers of a job."""
        if job_id not in self._subscribers:
            return
        
        # Format as SSE
        sse_data = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        
        # Send to all subscribers
        for queue in self._subscribers[job_id]:
            try:
                queue.put_nowait(sse_data)
            except asyncio.QueueFull:
                # Skip if queue is full (slow consumer)
                pass
    
    def emit_log(self, job_id: str, message: str, level: str = "info") -> None:
        """Emit a log message."""
        self.emit(job_id, "log", {"message": message, "level": level})
    
    def emit_job_updated(self, job_id: str, job_data: dict) -> None:
        """Emit job updated event."""
        self.emit(job_id, "job.updated", job_data)
    
    def emit_step_updated(self, job_id: str, step_data: dict) -> None:
        """Emit step updated event."""
        self.emit(job_id, "step.updated", step_data)


# Global pubsub instance
pubsub = PubSub()
