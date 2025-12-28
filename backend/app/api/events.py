from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.pubsub import pubsub


router = APIRouter()


@router.get("/jobs/{job_id}/events")
async def stream_events(job_id: str):
    """
    Stream SSE events for a job.
    
    Events:
    - job.updated: Job status/data changed
    - step.updated: Step status/data changed
    - log: Log message
    """
    async def event_generator():
        async for event in pubsub.subscribe(job_id):
            yield event
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )
