"""Real model clients: GroundingDINO, SAM 2, CLIP.

Imported lazily at startup only when USE_REAL_MODELS=1, so the stub path
never pays the model-load cost.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, List

import numpy as np
import torch
from PIL import Image

from app.clients.base import (
    Detection,
    DetectionClient,
    LabelScore,
    LabelingClient,
    SegmentationClient,
    SegmentationMask,
)
from app.schemas import SemanticViewInput

if TYPE_CHECKING:
    pass


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_image_rgb(path: str) -> tuple[np.ndarray, Image.Image]:
    pil = Image.open(path).convert("RGB")
    return np.array(pil), pil


# ── GroundingDINO ─────────────────────────────────────────────────────────────

class RealGroundingDINOClient(DetectionClient):
    def __init__(self, config_path: str, checkpoint_path: str, device: str,
                 box_threshold: float, text_threshold: float) -> None:
        from groundingdino.util.inference import load_model, predict

        self._predict = predict
        self._model = load_model(config_path, checkpoint_path, device=device)
        self._device = device
        self._box_thr = box_threshold
        self._text_thr = text_threshold

    def detect(self, views: List[SemanticViewInput]) -> List[Detection]:
        from groundingdino.util.inference import load_image

        detections: List[Detection] = []
        for view_index, view in enumerate(views):
            if not view.prompt_terms:
                continue
            caption = " . ".join(view.prompt_terms) + " ."
            _, img_tensor = load_image(view.image_path)
            boxes, scores, labels = self._predict(
                model=self._model,
                image=img_tensor,
                caption=caption,
                box_threshold=self._box_thr,
                text_threshold=self._text_thr,
            )
            for box, score, label in zip(boxes.tolist(), scores.tolist(), labels):
                # box is [cx, cy, w, h] normalized → convert to [x0, y0, x1, y1]
                cx, cy, w, h = box
                detections.append(Detection(
                    view_index=view_index,
                    bbox=[cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                    label=label,
                    score=round(float(score), 4),
                ))
        return detections


# ── SAM 2 ─────────────────────────────────────────────────────────────────────

class RealSAM2Client(SegmentationClient):
    def __init__(self, checkpoint: str, config_name: str, device: str) -> None:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        sam2_model = build_sam2(config_name, checkpoint, device=device)
        self._predictor = SAM2ImagePredictor(sam2_model)
        self._device = device

    def segment(
        self, views: List[SemanticViewInput], detections: List[Detection]
    ) -> List[SegmentationMask]:
        if not detections:
            return []

        masks: List[SegmentationMask] = []
        # Group detections by view so we only set_image once per view
        from collections import defaultdict
        by_view: dict[int, list[Detection]] = defaultdict(list)
        for det in detections:
            by_view[det.view_index].append(det)

        for view_index, dets in by_view.items():
            if view_index >= len(views):
                continue
            img_np, _ = _load_image_rgb(views[view_index].image_path)
            self._predictor.set_image(img_np)
            h, w = img_np.shape[:2]

            for det in dets:
                x0, y0, x1, y1 = det.bbox
                # bbox is normalized → pixel coords
                box_px = np.array([x0 * w, y0 * h, x1 * w, y1 * h])[None]
                pred_masks, pred_scores, _ = self._predictor.predict(
                    box=box_px,
                    multimask_output=False,
                )
                score = float(pred_scores[0]) if pred_scores.size else det.score
                masks.append(SegmentationMask(
                    view_index=view_index,
                    bbox=det.bbox,
                    score=round(score, 4),
                ))
        return masks


# ── CLIP ──────────────────────────────────────────────────────────────────────

class RealCLIPLabelingClient(LabelingClient):
    def __init__(self, model_name: str, device: str, cache_dir: str | None,
                 top_k: int = 5) -> None:
        import clip

        self._model, self._preprocess = clip.load(
            model_name, device=device, download_root=cache_dir
        )
        self._device = device
        self._top_k = top_k

    def rank(
        self, views: List[SemanticViewInput], detections: List[Detection]
    ) -> List[LabelScore]:
        import clip

        # Collect candidate labels from detections + prompt_terms
        candidate_set: dict[str, float] = {}
        for det in detections:
            candidate_set[det.label] = max(candidate_set.get(det.label, 0.0), det.score)
        for view in views:
            for term in view.prompt_terms:
                if term not in candidate_set:
                    candidate_set[term] = 0.0

        if not candidate_set:
            return []

        candidates = list(candidate_set.keys())
        text_tokens = clip.tokenize(candidates).to(self._device)

        images = []
        for view in views:
            try:
                pil = Image.open(view.image_path).convert("RGB")
                images.append(self._preprocess(pil))
            except Exception:
                pass

        if not images:
            # Fall back to detection scores only
            ordered = sorted(candidate_set.items(), key=lambda kv: kv[1], reverse=True)
            return [LabelScore(name=n, score=s) for n, s in ordered[: self._top_k]]

        image_tensor = torch.stack(images).to(self._device)
        with torch.no_grad():
            image_features = self._model.encode_image(image_tensor)
            text_features = self._model.encode_text(text_tokens)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            # Mean over views, then softmax similarity
            sim = (image_features.mean(0) @ text_features.T).softmax(dim=-1)

        scores = sim.cpu().tolist()
        ranked = sorted(zip(candidates, scores), key=lambda kv: kv[1], reverse=True)
        return [LabelScore(name=n, score=round(float(s), 4)) for n, s in ranked[: self._top_k]]


# ── factory ───────────────────────────────────────────────────────────────────

def build_real_clients(
    gdino_config: str,
    gdino_checkpoint: str,
    sam2_checkpoint: str,
    sam2_config: str,
    clip_model: str,
    clip_cache_dir: str | None,
    device: str,
    gdino_box_threshold: float,
    gdino_text_threshold: float,
):
    detector = RealGroundingDINOClient(
        config_path=gdino_config,
        checkpoint_path=gdino_checkpoint,
        device=device,
        box_threshold=gdino_box_threshold,
        text_threshold=gdino_text_threshold,
    )
    segmenter = RealSAM2Client(
        checkpoint=sam2_checkpoint,
        config_name=sam2_config,
        device=device,
    )
    labeler = RealCLIPLabelingClient(
        model_name=clip_model,
        device=device,
        cache_dir=clip_cache_dir,
    )
    return detector, segmenter, labeler
