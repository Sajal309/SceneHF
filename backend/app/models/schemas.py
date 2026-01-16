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
    REFRAME = "REFRAME"


class StepStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


class AssetKind(str, Enum):
    SOURCE = "SOURCE"
    PLATE = "PLATE"
    LAYER = "LAYER"
    MASK = "MASK"
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
    STOP = "STOP"

class MaskMode(str, Enum):
    NONE = "NONE"
    AUTO = "AUTO"
    MANUAL = "MANUAL"


class MaskIntent(str, Enum):
    INPAINT_REMOVE = "INPAINT_REMOVE"
    INPAINT_INSERT = "INPAINT_INSERT"
    EXTRACT_HELPER = "EXTRACT_HELPER"


class Step(BaseModel):
    id: str
    index: int
    name: str
    type: StepType
    status: StepStatus = StepStatus.QUEUED
    input_asset_id: Optional[str] = None
    output_asset_id: Optional[str] = None
    mask_mode: MaskMode = MaskMode.NONE
    mask_asset_id: Optional[str] = None
    mask_intent: Optional[MaskIntent] = None
    mask_prompt: Optional[str] = None
    prompt: str = ""
    prompt_variations: List[str] = Field(default_factory=list)
    custom_prompt: Optional[str] = None
    image_config: Optional[Dict[str, Any]] = None
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
    prompt_variations: List[str] = Field(default_factory=list)
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
    provider: Optional[str] = "openai"
    llm_config: Optional[Dict[str, Any]] = Field(default_factory=dict, alias="model_config")  # alias to accept frontend's JSON
    image_config: Optional[Dict[str, Any]] = Field(default_factory=dict)
    scene_description: Optional[str] = None
    layer_count: Optional[int] = None
    layer_map: Optional[List[Dict[str, Any]]] = None



class RetryRequest(BaseModel):
    custom_prompt: str
    image_config: Optional[Dict[str, Any]] = None


class PlateAndRetryRequest(BaseModel):
    remove_prompt: str
    retry_prompt: str


class PromptVariationsRequest(BaseModel):
    provider: str
    llm_config: Dict[str, Any] = Field(default_factory=dict, alias="model_config")


class StepPatchRequest(BaseModel):
    mask_mode: Optional[MaskMode] = None
    mask_asset_id: Optional[str] = None
    mask_intent: Optional[MaskIntent] = None
    mask_prompt: Optional[str] = None


class ReframeRequest(BaseModel):
    image_config: Optional[Dict[str, Any]] = Field(default_factory=dict)
    prompt: Optional[str] = None
