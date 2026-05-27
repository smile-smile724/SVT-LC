from dataclasses import dataclass
from typing import List, Protocol

from app.schemas import SemanticViewInput


@dataclass
class Detection:
    view_index: int
    bbox: List[float]
    label: str
    score: float


@dataclass
class SegmentationMask:
    view_index: int
    bbox: List[float]
    score: float


@dataclass
class LabelScore:
    name: str
    score: float


class DetectionClient(Protocol):
    def detect(self, views: List[SemanticViewInput]) -> List[Detection]:
        ...


class SegmentationClient(Protocol):
    def segment(self, views: List[SemanticViewInput], detections: List[Detection]) -> List[SegmentationMask]:
        ...


class LabelingClient(Protocol):
    def rank(self, views: List[SemanticViewInput], detections: List[Detection]) -> List[LabelScore]:
        ...
