from dataclasses import dataclass
from typing import Optional

from app.clients import (
    DetectionClient,
    LabelingClient,
    SegmentationClient,
    build_default_clients,
)
from app.schemas import (
    SaliencyRegion,
    SemanticExtractionRequest,
    SemanticExtractionResponse,
    SemanticLabel,
)


@dataclass
class SemanticPipeline:
    """Three-stage semantic extraction: detect -> segment -> label.

    Each stage hides behind a client interface so a real GroundingDINO /
    SAM 2 / CLIP backend can be dropped in by swapping the constructor
    arguments. The pipeline never imports model code directly.
    """

    detector: DetectionClient
    segmenter: SegmentationClient
    labeler: LabelingClient

    def run(self, request: SemanticExtractionRequest) -> SemanticExtractionResponse:
        detections = self.detector.detect(request.views)
        masks = self.segmenter.segment(request.views, detections)
        ranked_labels = self.labeler.rank(request.views, detections)

        labels = [SemanticLabel(name=item.name, score=item.score) for item in ranked_labels]
        saliency = [SaliencyRegion(bbox=mask.bbox, score=mask.score) for mask in masks]
        thumbs = [view.image_path for view in request.views[:2]]
        semantic_score = labels[0].score if labels else 0.0

        return SemanticExtractionResponse(
            block_id=request.block_id,
            labels=labels,
            saliency=saliency,
            thumbs=thumbs,
            semantic_score=semantic_score,
            notes=[
                f"detect={len(detections)} segment={len(masks)} label={len(labels)}",
                "Stub clients in use; replace via SemanticPipeline(...) at startup.",
            ],
        )


_default_pipeline: Optional[SemanticPipeline] = None


def get_pipeline() -> SemanticPipeline:
    global _default_pipeline
    if _default_pipeline is None:
        from app.config import (
            CLIP_CACHE_DIR, CLIP_MODEL, DEVICE,
            GDINO_BOX_THRESHOLD, GDINO_CHECKPOINT, GDINO_CONFIG,
            GDINO_TEXT_THRESHOLD, SAM2_CHECKPOINT, SAM2_CONFIG,
            USE_REAL_MODELS,
        )
        if USE_REAL_MODELS:
            from app.clients.real import build_real_clients
            detector, segmenter, labeler = build_real_clients(
                gdino_config=str(GDINO_CONFIG),
                gdino_checkpoint=str(GDINO_CHECKPOINT),
                sam2_checkpoint=str(SAM2_CHECKPOINT),
                sam2_config=SAM2_CONFIG,
                clip_model=CLIP_MODEL,
                clip_cache_dir=CLIP_CACHE_DIR,
                device=DEVICE,
                gdino_box_threshold=GDINO_BOX_THRESHOLD,
                gdino_text_threshold=GDINO_TEXT_THRESHOLD,
            )
        else:
            detector, segmenter, labeler = build_default_clients()
        _default_pipeline = SemanticPipeline(detector, segmenter, labeler)
    return _default_pipeline


def extract_semantics(request: SemanticExtractionRequest) -> SemanticExtractionResponse:
    return get_pipeline().run(request)
