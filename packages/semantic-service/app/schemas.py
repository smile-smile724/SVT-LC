from typing import List

from pydantic import BaseModel, Field


class SemanticViewInput(BaseModel):
    image_path: str = Field(..., description="Absolute path to the rendered canonical view")
    prompt_terms: List[str] = Field(default_factory=list)


class SemanticExtractionRequest(BaseModel):
    block_id: str
    bbox: List[float]
    views: List[SemanticViewInput]


class SemanticLabel(BaseModel):
    name: str
    score: float


class SaliencyRegion(BaseModel):
    bbox: List[float]
    score: float


class SemanticExtractionResponse(BaseModel):
    block_id: str
    labels: List[SemanticLabel]
    saliency: List[SaliencyRegion]
    thumbs: List[str]
    semantic_score: float
    notes: List[str] = Field(default_factory=list)
