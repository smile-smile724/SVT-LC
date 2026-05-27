from typing import List, Tuple

from app.clients.base import (
    Detection,
    DetectionClient,
    LabelingClient,
    LabelScore,
    SegmentationClient,
    SegmentationMask,
)
from app.schemas import SemanticViewInput


class StubGroundingDINOClient(DetectionClient):
    """Deterministic stand-in for GroundingDINO open-set detection.

    Emits one detection per (view, prompt term) pair so downstream stages
    have something stable to consume until a real model is wired in.
    """

    def detect(self, views: List[SemanticViewInput]) -> List[Detection]:
        detections: List[Detection] = []
        for view_index, view in enumerate(views):
            for term_index, term in enumerate(view.prompt_terms):
                score = max(0.4, 0.92 - term_index * 0.12)
                detections.append(
                    Detection(
                        view_index=view_index,
                        bbox=[0.1 + term_index * 0.05, 0.1, 0.7, 0.7],
                        label=term,
                        score=round(score, 2),
                    )
                )
        return detections


class StubSAM2Client(SegmentationClient):
    def segment(
        self, views: List[SemanticViewInput], detections: List[Detection]
    ) -> List[SegmentationMask]:
        if not views:
            return []
        if not detections:
            return [
                SegmentationMask(view_index=0, bbox=[0.1, 0.1, 0.7, 0.7], score=0.5)
            ]
        return [
            SegmentationMask(
                view_index=det.view_index,
                bbox=det.bbox,
                score=round(min(0.95, det.score + 0.05), 2),
            )
            for det in detections
        ]


class StubCLIPLabelingClient(LabelingClient):
    """Aggregates detections into a deduped, score-sorted top-K label list."""

    def __init__(self, top_k: int = 3) -> None:
        self.top_k = top_k

    def rank(
        self, views: List[SemanticViewInput], detections: List[Detection]
    ) -> List[LabelScore]:
        if detections:
            best: dict[str, float] = {}
            for det in detections:
                best[det.label] = max(best.get(det.label, 0.0), det.score)
            ordered = sorted(best.items(), key=lambda kv: kv[1], reverse=True)
            return [LabelScore(name=name, score=score) for name, score in ordered[: self.top_k]]

        prompt_terms = [term for view in views for term in view.prompt_terms]
        unique_terms: List[str] = list(dict.fromkeys(prompt_terms))[: self.top_k]
        return [
            LabelScore(name=term, score=round(max(0.5, 0.95 - index * 0.15), 2))
            for index, term in enumerate(unique_terms)
        ]


def build_default_clients() -> Tuple[DetectionClient, SegmentationClient, LabelingClient]:
    return StubGroundingDINOClient(), StubSAM2Client(), StubCLIPLabelingClient()
