from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    IDLE = "IDLE"
    PLANNED = "PLANNED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    DONE = "DONE"
    FAILED = "FAILED"


class StepType(str, Enum):
    ANALYZE = "ANALYZE"
    EXTRACT = "EXTRACT"
    REMOVE = "REMOVE"
    BG_REMOVE = "BG_REMOVE"


class StepStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class AssetKind(str, Enum):
    SOURCE = "SOURCE"
    PLATE = "PLATE"
    LAYER = "LAYER"
    BG_REMOVED = "BG_REMOVED"
    DEBUG = "DEBUG"


class Asset(BaseModel):
    id: str
    kind: AssetKind
    path: str
    width: Optional[int] = None
    height: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ValidationResult(BaseModel):
    passed: bool
    status: StepStatus  # SUCCESS, NEEDS_REVIEW, or FAILED
    metrics: Dict[str, float] = Field(default_factory=dict)
    notes: str = ""


class StepAction(str, Enum):
    ACCEPT = "ACCEPT"
    RETRY = "RETRY"
    BG_REMOVE = "BG_REMOVE"
    PLATE_AND_RETRY = "PLATE_AND_RETRY"


class Step(BaseModel):
    id: str
    index: int
    name: str
    type: StepType
    status: StepStatus = StepStatus.QUEUED
    input_asset_id: Optional[str] = None
    output_asset_id: Optional[str] = None
    prompt: str = ""
    custom_prompt: Optional[str] = None
    validation: Optional[ValidationResult] = None
    actions_available: List[StepAction] = Field(default_factory=list)
    logs: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PlanStep(BaseModel):
    id: str
    name: str
    type: StepType
    target: str = ""
    prompt: str
    validation_rules: Dict[str, float] = Field(default_factory=dict)
    fallbacks: List[Dict[str, Any]] = Field(default_factory=list)


class Plan(BaseModel):
    scene_summary: str
    global_rules: List[str] = Field(default_factory=list)
    steps: List[PlanStep] = Field(default_factory=list)


class Job(BaseModel):
    id: str
    status: JobStatus = JobStatus.IDLE
    source_image: Optional[str] = None  # asset id
    plan: Optional[Plan] = None
    steps: List[Step] = Field(default_factory=list)
    assets: Dict[str, Asset] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# Request/Response models for API
class JobCreateResponse(BaseModel):
    job_id: str
    message: str


class PlanRequest(BaseModel):
    provider: Optional[str] = "gemini"
    llm_config: Optional[Dict[str, Any]] = Field(default_factory=dict, alias="model_config")  # alias to accept frontend's JSON
    image_config: Optional[Dict[str, Any]] = Field(default_factory=dict)



class RetryRequest(BaseModel):
    custom_prompt: str


class PlateAndRetryRequest(BaseModel):
    remove_prompt: str
    retry_prompt: str
