/// <reference types="vite/client" />
import * as THREE from 'three';
import type {
  LayerName,
  RuntimeQueueEntry,
  ScheduleDecision,
  SceneManifest,
  SemanticManifest
} from '@mtweb/shared-contracts';
import { SemanticPriorityLayerQueue } from './runtime/splq.js';
import { parseExperimentConfig } from './experiment/config.js';
import { GltfLoader, createBlockRecord, getCoarseUri, getResidualUri, type BlockRecord } from './runtime/blockLoader.js';
import { buildScheduleRequest, requestSchedule } from './runtime/telemetry.js';
import {
  createMetrics,
  exportLayerEventsCsv,
  exportSummaryCsv,
  exportViewCyclesCsv,
  fsvMs,
  recordBandwidthSaving,
  recordLayerReady,
  recordLayerStart,
  recordSchedule,
  recordScheduleFailure,
  recordRotationComplete,
  recordRotationRecovered,
  recordRotationStart,
  markSemanticGuidedCoarseCandidate,
  recordSemanticRankingSample,
  recordSemanticPriorityHit,
  recordSemanticFidelity,
  recordViewCycle,
  setExpectedResidualTargets,
  setExpectedSemanticTargets,
  totalBytes,
  totalLoadCount,
  triggerCsvDownload,
  ttfbMs,
  getStatistics,
  recordRenderFrame
} from './runtime/metrics.js';

const MAX_CONCURRENT_LOADS = 2;
const SEM_PREFETCH_TOP_H = 3;
const SEM_FAST_LANE_TOP_COUNT = 1;
const FIRST_SCREEN_COARSE_COUNT = 2;
const QUEUE_TICK_MS = 250;
const SCHEDULE_INTERVAL_MS = 1500;
const SCHEDULER_URL = (import.meta.env.VITE_SCHEDULER_URL as string | undefined) ?? 'http://localhost:8787';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root element');

app.innerHTML = `
  <div style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; min-height: 100vh; background:
    radial-gradient(circle at top left, rgba(255, 214, 140, 0.6), transparent 28%),
    linear-gradient(180deg, #f4efe4 0%, #e6edf6 48%, #dbe7f5 100%);
    color: #102238; padding: 28px; box-sizing: border-box;">
    <header style="display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 22px;">
      <div>
        <div style="font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #6c5d3d;">Semantic-MT-Web3D</div>
        <h1 style="margin: 10px 0 6px; font-size: 34px; font-weight: 700;">Block Streaming Runtime</h1>
        <p style="margin: 0; max-width: 780px; line-height: 1.55; color: #334a63;">
          The viewer streams blocks driven by the scheduler-service. Telemetry is posted on every cycle; the returned
          decisions seed the S-PLQ. If the scheduler is offline we fall back to a local heuristic.
        </p>
      </div>
      <div style="min-width: 280px; background: rgba(255,255,255,0.88); border: 1px solid rgba(16,34,56,0.12); border-radius: 18px; padding: 16px 18px; box-shadow: 0 18px 50px rgba(30, 60, 90, 0.08);">
        <div style="font-size: 12px; color: #5d6a79;">Runtime Status</div>
        <div id="status-line" style="margin-top: 8px; font-size: 15px; font-weight: 600;">Waiting for manifest...</div>
        <div id="status-subline" style="margin-top: 6px; font-size: 13px; color: #55697d;">Waiting for scene root...</div>
      </div>
    </header>
    <main style="display: grid; grid-template-columns: minmax(360px, 1fr) 380px; gap: 20px; align-items: start;">
      <section style="background: rgba(255,255,255,0.9); border: 1px solid rgba(16,34,56,0.12); border-radius: 22px; overflow: hidden; box-shadow: 0 18px 50px rgba(30, 60, 90, 0.08);">
        <div style="padding: 16px 18px; border-bottom: 1px solid rgba(16,34,56,0.08); display: flex; justify-content: space-between; gap: 12px; align-items: center;">
          <div>
            <h2 style="margin: 0; font-size: 19px;">Three.js Viewport</h2>
            <div id="viewport-meta" style="margin-top: 4px; font-size: 13px; color: #5b6f86;">Preparing scene assets...</div>
          </div>
          <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7e6a39;">Scheduler-driven Streaming</div>
        </div>
        <canvas id="viewport" style="display: block; width: 100%; height: 520px;"></canvas>
      </section>
      <section style="display: grid; gap: 20px;">
        <article style="background: rgba(255,255,255,0.9); border: 1px solid rgba(16,34,56,0.12); border-radius: 22px; padding: 18px; box-shadow: 0 18px 50px rgba(30, 60, 90, 0.08);">
          <h2 style="margin: 0 0 10px; font-size: 19px;">Scene Blocks</h2>
          <div id="block-summary" style="font-size: 14px; color: #44576d; margin-bottom: 12px;">Manifest not loaded yet.</div>
          <div id="block-table" style="font-size: 14px;"></div>
        </article>
        <article style="background: rgba(255,255,255,0.9); border: 1px solid rgba(16,34,56,0.12); border-radius: 22px; padding: 18px; box-shadow: 0 18px 50px rgba(30, 60, 90, 0.08);">
          <h2 style="margin: 0 0 10px; font-size: 19px;">S-PLQ Hot Cache</h2>
          <div id="queue-summary" style="font-size: 14px; margin-bottom: 12px;"></div>
          <div id="queue-table" style="font-size: 14px;"></div>
        </article>
        <article style="background: rgba(255,255,255,0.9); border: 1px solid rgba(16,34,56,0.12); border-radius: 22px; padding: 18px; box-shadow: 0 18px 50px rgba(30, 60, 90, 0.08);">
          <h2 style="margin: 0 0 10px; font-size: 19px;">Telemetry &amp; Metrics</h2>
          <div id="metrics-panel" style="font-size: 13px; color: #44576d;">Waiting for first schedule cycle...</div>
        </article>
      </section>
    </main>
  </div>
`;

const viewport = document.querySelector<HTMLCanvasElement>('#viewport')!;
const statusHeadline = document.querySelector<HTMLDivElement>('#status-line')!;
const statusDetail = document.querySelector<HTMLDivElement>('#status-subline')!;
const viewportMetaLabel = document.querySelector<HTMLDivElement>('#viewport-meta')!;
const blockSummaryPanel = document.querySelector<HTMLDivElement>('#block-summary')!;
const blockTablePanel = document.querySelector<HTMLDivElement>('#block-table')!;
const queueSummaryPanel = document.querySelector<HTMLDivElement>('#queue-summary')!;
const queueTablePanel = document.querySelector<HTMLDivElement>('#queue-table')!;
const metricsPanel = document.querySelector<HTMLDivElement>('#metrics-panel')!;

const renderer = new THREE.WebGLRenderer({ canvas: viewport, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const gl = renderer.getContext();
const gpuTimerExtension = (() => {
  try {
    return (
      gl.getExtension('EXT_disjoint_timer_query_webgl2') ||
      gl.getExtension('EXT_disjoint_timer_query')
    ) as any;
  } catch {
    return null;
  }
})();
const gpuTimerQueries: any[] = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color('#edf2f8');
scene.fog = new THREE.Fog('#edf2f8', 12, 24);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(5, 3.5, 5);

const rootGroup = new THREE.Group();
scene.add(rootGroup);

const floor = new THREE.Mesh(
  new THREE.CylinderGeometry(5.6, 6.4, 0.18, 72),
  new THREE.MeshStandardMaterial({ color: '#d4deec', roughness: 0.95, metalness: 0.05 })
);
floor.position.y = -1.3;
scene.add(floor);
scene.add(new THREE.GridHelper(12, 24, '#8090a7', '#c2cfdf').translateY(-1.2));
scene.add(new THREE.HemisphereLight('#fff5d8', '#7d8da1', 1.35));
const keyLight = new THREE.DirectionalLight('#ffffff', 1.55);
keyLight.position.set(6, 8, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight('#d6ecff', 0.9);
fillLight.position.set(-5, 3, -6);
scene.add(fillLight);

function resizeRenderer(): void {
  const rect = viewport.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

const orbitCenter = new THREE.Vector3(0, 0, 0);
let orbitRadius = 7.5;
const clock = new THREE.Clock();
const ROTATION_DRAG_SENSITIVITY = Math.PI / 720;
const ROTATION_SETTLE_MS = 500;

let rotationState = 0; // 0 = idle, 1 = rotation in progress, 2 = rotation completed
let staticOrbitAngle = 0; // used when config.rotationAngle > 0
let rotationDragActive = false;
let rotationDragLastX = 0;
let rotationGestureReleasedAt: number | undefined;

function beginGpuTimerQuery(): any | null {
  if (!gpuTimerExtension) return null;
  try {
    const query = typeof (gl as any).createQuery === 'function'
      ? (gl as any).createQuery()
      : gpuTimerExtension.createQueryEXT();
    const target = gpuTimerExtension.TIME_ELAPSED_EXT;
    if (typeof (gl as any).beginQuery === 'function') {
      (gl as any).beginQuery(target, query);
    } else {
      gpuTimerExtension.beginQueryEXT(target, query);
    }
    return { query, target };
  } catch {
    return null;
  }
}

function endGpuTimerQuery(handle: any | null): void {
  if (!handle || !gpuTimerExtension) return;
  try {
    if (typeof (gl as any).endQuery === 'function') {
      (gl as any).endQuery(handle.target);
    } else {
      gpuTimerExtension.endQueryEXT(handle.target);
    }
    gpuTimerQueries.push(handle.query);
  } catch {
    // GPU timing is best-effort and must not affect the experiment.
  }
}

function pollGpuTimerMs(): number | null {
  if (!gpuTimerExtension || gpuTimerQueries.length === 0) return null;
  const query = gpuTimerQueries[0];
  try {
    const available = typeof (gl as any).getQueryParameter === 'function'
      ? (gl as any).getQueryParameter(query, (gl as any).QUERY_RESULT_AVAILABLE)
      : gpuTimerExtension.getQueryObjectEXT(query, gpuTimerExtension.QUERY_RESULT_AVAILABLE_EXT);
    const disjoint = gl.getParameter(gpuTimerExtension.GPU_DISJOINT_EXT);
    if (!available || disjoint) return null;
    const result = typeof (gl as any).getQueryParameter === 'function'
      ? (gl as any).getQueryParameter(query, (gl as any).QUERY_RESULT)
      : gpuTimerExtension.getQueryObjectEXT(query, gpuTimerExtension.QUERY_RESULT_EXT);
    if (typeof (gl as any).deleteQuery === 'function') {
      (gl as any).deleteQuery(query);
    } else {
      gpuTimerExtension.deleteQueryEXT(query);
    }
    gpuTimerQueries.shift();
    return result / 1000000;
  } catch {
    gpuTimerQueries.shift();
    return null;
  }
}

function countRenderableObjects(root: THREE.Object3D): { meshObjects: number; renderInstances: number } {
  let meshObjects = 0;
  let renderInstances = 0;
  root.traverse((object) => {
    const maybeMesh = object as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (!maybeMesh.isMesh) return;
    meshObjects += 1;
    renderInstances += maybeMesh.isInstancedMesh && typeof maybeMesh.count === 'number' ? maybeMesh.count : 1;
  });
  return { meshObjects, renderInstances };
}

renderer.setAnimationLoop(() => {
  if (config.rotationAngle > 0) {
    orbitAngle = staticOrbitAngle;
  } else {
    const elapsed = clock.getElapsedTime();
    orbitAngle = elapsed * 0.24;
  }
  camera.position.set(
    orbitCenter.x + Math.cos(orbitAngle) * orbitRadius,
    orbitCenter.y + orbitRadius * 0.35,
    orbitCenter.z + Math.sin(orbitAngle) * orbitRadius
  );
  camera.lookAt(orbitCenter);
  const cpuFrameStart = performance.now();
  const gpuQuery = beginGpuTimerQuery();
  renderer.render(scene, camera);
  endGpuTimerQuery(gpuQuery);
  const cpuFrameTimeMs = performance.now() - cpuFrameStart;
  const gpuFrameTimeMs = pollGpuTimerMs();
  const renderCounts = countRenderableObjects(scene);

  // 记录帧时间和卡顿
  recordRenderFrame(metrics, rotationState === 1, {
    cpuFrameTimeMs,
    gpuFrameTimeMs,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    meshObjects: renderCounts.meshObjects,
    renderInstances: renderCounts.renderInstances
  });
});

const metrics = createMetrics();
const config = parseExperimentConfig();
const statisticsContext = {
  method: config.method,
  useSemantic: config.useSemantic,
  strategy: config.strategy
};
let lastDecisions = new Map<string, ScheduleDecision>();
let schedulerOnline = false;
let orbitAngle = 0;

bootstrap().catch((error: unknown) => {
  console.error('[web-client] fatal error', error);
  statusHeadline.textContent = 'Failed to load scene manifest';
  statusDetail.textContent = error instanceof Error ? error.message : String(error);
  viewportMetaLabel.textContent = 'Inspect the browser console for details.';
});

async function bootstrap(): Promise<void> {
  updateStatus('Loading scene manifest...', `${config.sceneRoot}/manifest/blocks.json`);
  const manifestPayload = await fetchJson<SceneManifest>(sceneAssetUrl('manifest/blocks.json'), {
    priority: 'high'
  } as RequestInit);
  const manifest = manifestPayload.data;

  // blockCount URL 参数：限制加载的 block 数量，用于 FPS vs 模型大小实验
  const blockCountParam = new URLSearchParams(window.location.search).get('blockCount');
  const blockCountLimit = blockCountParam !== null ? Math.max(1, parseInt(blockCountParam, 10)) : manifest.blocks.length;
  const activeBlocks = manifest.blocks.slice(0, blockCountLimit);
  const activeManifest = { ...manifest, blocks: activeBlocks, partition: { ...manifest.partition, blockCount: activeBlocks.length } };

  const records: BlockRecord[] = activeManifest.blocks.map((block) => createBlockRecord(block));

  const totalSeed = records.reduce(
    (sum, r) => sum + (r.block.bytes?.coarse ?? 0) + (r.block.bytes?.residual ?? 0) + 1024,
    0
  );
  const queueBudget = Math.max(8 * 1024, Math.round(totalSeed * 1.5));
  const queue = new SemanticPriorityLayerQueue(queueBudget);
  const loader = new GltfLoader();

  setExpectedSemanticTargets(metrics, config.useSemantic ? records.filter((record) => record.block.semantic?.manifestUri).length : 0);
  setExpectedResidualTargets(metrics, records.filter((record) => getResidualUri(record.block)).length);

  fitOrbitToBlocks(records);
  renderBlockSummary(activeManifest, records);

  const startRotationDrag = (clientX: number): void => {
    if (config.rotationAngle <= 0 || rotationState !== 0) return;
    rotationState = 1;
    rotationDragActive = true;
    rotationDragLastX = clientX;
    rotationGestureReleasedAt = undefined;
    recordRotationStart(metrics);
    // 移除同步销毁高精度模型对象的操作，避免 Three.js 场景树重组和 GC 导致的 40ms 卡顿
    // resetResidualBlocks(records);
  };

  const updateRotationDrag = (clientX: number): void => {
    if (!rotationDragActive || rotationState !== 1) return;
    const deltaX = clientX - rotationDragLastX;
    if (deltaX !== 0) {
      staticOrbitAngle += deltaX * ROTATION_DRAG_SENSITIVITY;
      rotationDragLastX = clientX;
    }
  };

  const endRotationDrag = (): void => {
    if (!rotationDragActive) return;
    rotationDragActive = false;
    rotationGestureReleasedAt = performance.now();
  };

  viewport.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    startRotationDrag(event.clientX);
    updateRotationDrag(event.clientX);
  });
  window.addEventListener('mousemove', (event) => {
    updateRotationDrag(event.clientX);
  });
  window.addEventListener('mouseup', endRotationDrag);
  window.addEventListener('blur', endRotationDrag);

  let activeLoads = 0;
  const coarseReadyAt = new Map<string, number>();

  let viewCycleTimer = 0;
  const VIEW_CYCLE_INTERVAL_MS = 2000;

  const tick = (): void => {
    seedQueueFromDecisions(records, queue);
    if (config.useSPLQ) {
      queue.evictUntilWithinBudget();
    }
    renderQueuePanel(queue);
    renderBlockSummary(activeManifest, records);
    renderMetrics();

    viewCycleTimer += QUEUE_TICK_MS;
    if (viewCycleTimer >= VIEW_CYCLE_INTERVAL_MS) {
      recordViewCycle(metrics, orbitAngle);
      viewCycleTimer = 0;
    }

    // --- Rotation Test Logic ---
    if (config.rotationAngle > 0) {
      if (rotationState === 1) {
        // Consider rotation 'completed' when the gesture has ended, the queue is drained,
        // and the view has had time to settle after the drag.
        const gestureSettled =
          rotationGestureReleasedAt !== undefined &&
          (performance.now() - rotationGestureReleasedAt) > ROTATION_SETTLE_MS;
        if (!rotationDragActive && activeLoads === 0 && gestureSettled) {
          recordRotationComplete(metrics);
          recordRotationRecovered(metrics);
          rotationState = 2;
          // Expose signal for Playwright to detect completion
          (window as any).experimentRotationDone = true;
        }
      }
    }
    // ---------------------------

    const maxConcurrentLoads = Math.max(
      1,
      Math.min(MAX_CONCURRENT_LOADS + 1, config.strategy.maxConcurrentLoads)
    );
    while (activeLoads < maxConcurrentLoads) {
      const next = pickNextEntry(queue, records, coarseReadyAt);
      if (!next) break;
      activeLoads += 1;
      void loadEntry(next.record, next.layer, loader, coarseReadyAt)
        .catch((error) => {
          console.error('[web-client] block load failed', next.record.block.blockId, next.layer, error);
        })
        .finally(() => {
          activeLoads -= 1;
        });
    }
  };

  tick();
  setInterval(tick, QUEUE_TICK_MS);
  if (config.useScheduling) {
    // Defer the scheduler loop until the first coarse block is rendered.
    //
    // Each scheduler HTTP roundtrip (POST localhost:8787/schedule) consumes real
    // bandwidth under CDP throttling.  At 0.05 Mbps the ~11 roundtrips that would
    // otherwise fire during the ~13s first-coarse window steal ~4s of bandwidth,
    // inflating interaction_latency from ~12.8s to ~16.8s.
    //
    // After firstCoarseReadyAt is set (interaction_latency is already measured),
    // the scheduler resumes normally and guides all subsequent parallel downloads.
    const deferredScheduler = async (): Promise<void> => {
      while (!records.some((r) => r.state.coarse === 'ready')) {
        await delay(50);
      }
      void schedulerLoop(records);
    };
    void deferredScheduler();
    updateStatus(`Streaming blocks (${config.method})`, `Scheduler: ${SCHEDULER_URL}`);
  } else {
    updateStatus(`Streaming blocks (${config.method})`, `Local heuristic only`);
  }

  viewportMetaLabel.textContent = `Scene ${activeManifest.sceneId} · ${activeManifest.partition.blockCount} blocks · method: ${config.method}`;
}

async function schedulerLoop(records: BlockRecord[]): Promise<void> {
  while (true) {
    try {
      const currentCameraPos = camera.position.clone();
      
      // 意图预测预取 (Intent Prediction Prefetching)
      // 如果用户正在大尺度拖拽视角，我们预测未来的相机朝向，提前让调度器计算未来的可见块
      if (rotationDragActive && rotationState === 1 && Math.abs(staticOrbitAngle) > Math.PI / 18) {
        // 如果旋转角度超过 10 度，我们预测其继续旋转的趋势
        const predictAngle = staticOrbitAngle * 1.5; // 往前看 50% 的旋转余量
        const radius = currentCameraPos.length(); // 保持当前的轨道半径
        // 假设简单的绕 Y 轴轨道旋转 (这与 fitOrbitToBlocks 的相机机制一致)
        currentCameraPos.x = Math.sin(predictAngle) * radius;
        currentCameraPos.z = Math.cos(predictAngle) * radius;
      }

      // 旋转期间使用更激进的策略：缩短 residual 延迟，加快新视角响应
      const activeStrategy = rotationState === 1
        ? { ...config.strategy, residualDelayMs: Math.min(config.strategy.residualDelayMs, 200) }
        : config.strategy;
      const request = buildScheduleRequest(records, {
        cameraPos: currentCameraPos,
        bandwidthMbps: config.bandwidth,
        rttMs: 40,
        taskLabels: config.taskLabels,
        hotCacheBytes: totalBytes(metrics),
        method: config.method,
        sceneId: inferSceneId(config.sceneRoot),
        strategy: activeStrategy
      });
      const response = await requestSchedule(SCHEDULER_URL, request);
      lastDecisions = new Map(response.items.map((item) => [item.blockId, item]));
      recordSchedule(metrics, response);
      recordSemanticRankingEvidence(records, response);
      schedulerOnline = true;
    } catch (error) {
      schedulerOnline = false;
      recordScheduleFailure(metrics);
      console.warn('[web-client] schedule request failed, falling back to local heuristic', error);
    }
    
    // 如果正在大视角旋转，加快调度频率以快速响应预取
    await delay(rotationState === 1 ? 500 : SCHEDULE_INTERVAL_MS);
  }
}

function seedQueueFromDecisions(records: BlockRecord[], queue: SemanticPriorityLayerQueue): void {
  refreshLocalPriorities(records);
  const rankByBlockId = computeQueueRanks(records);
  const hasCoarseReady = records.some((record) => record.state.coarse === 'ready');

  for (const [index, record] of records.entries()) {
    const decision = lastDecisions.get(record.block.blockId);
    const allowedLayers = decision ? new Set(decision.layers) : new Set<LayerName>(['sem', 'coarse', 'residual']);
    const decisionPriority = decision?.priority ?? record.priority;
    const baselinePriority = computeQueuePriority(record, decisionPriority, index, records.length);
    const queueRank = rankByBlockId.get(record.block.blockId) ?? index;
    const semBytes = record.semanticBytes ?? estimateSemanticBytes(record.semantic);
      const coarseBytes = record.block.bytes?.coarse ?? 0;
    const residualBytes = record.block.bytes?.residual ?? 0;

    if (
      allowedLayers.has('sem') &&
      config.useSemantic &&
      config.strategy.semanticPriority &&
      record.block.semantic &&
      queueRank < SEM_PREFETCH_TOP_H
    ) {
      const semBoost = semanticPriorityBoost(queueRank, hasCoarseReady);
      queue.upsert({
        key: `${record.block.blockId}:sem`,
        blockId: record.block.blockId,
        layer: 'sem',
        priority: clamp(baselinePriority + semBoost),
        bytes: semBytes
      });
    }
    // 旋转期间提升 coarse 优先级，确保新视角内容快速可见
    const coarseBoost = rotationState === 1 ? 0.18 : 0.05;
    if (allowedLayers.has('coarse') && coarseBytes > 0) {
      const firstScreenCoarsePriority = !hasCoarseReady && queueRank < FIRST_SCREEN_COARSE_COUNT
        ? 1 - queueRank * 0.02
        : 0;
      queue.upsert({
        key: `${record.block.blockId}:coarse`,
        blockId: record.block.blockId,
        layer: 'coarse',
        priority: clamp(Math.max(
          config.method === 'Seq-Load' ? baselinePriority + 0.2 : baselinePriority + coarseBoost,
          firstScreenCoarsePriority
        )),
        bytes: coarseBytes
      });
    }
    // 旋转期间降低 residual 优先级，避免占用带宽阻塞 coarse 加载
    const residualMultiplier = rotationState === 1 ? residualPriorityMultiplier() * 0.35 : residualPriorityMultiplier();
    if (allowedLayers.has('residual') && record.block.layers.residual) {
      queue.upsert({
        key: `${record.block.blockId}:residual`,
        blockId: record.block.blockId,
        layer: 'residual',
        priority: config.useLOD ? clamp(baselinePriority * residualMultiplier) : clamp(baselinePriority + 0.1),
        bytes: Math.max(256, residualBytes)
      });
    }
  }
}

function semanticPriorityBoost(queueRank: number, hasCoarseReady: boolean): number {
  if (queueRank < SEM_FAST_LANE_TOP_COUNT) {
    return hasCoarseReady ? 0.32 : 0.24;
  }
  return hasCoarseReady ? 0.12 : 0.03;
}

function computeQueueRanks(records: BlockRecord[]): Map<string, number> {
  return new Map(
    records
      .map((record, index) => {
        const decision = lastDecisions.get(record.block.blockId);
        const decisionPriority = decision?.priority ?? record.priority;
        return {
          blockId: record.block.blockId,
          priority: computeQueuePriority(record, decisionPriority, index, records.length)
        };
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.blockId.localeCompare(b.blockId);
      })
      .map((item, rank) => [item.blockId, rank])
  );
}

function computeQueuePriority(
  record: BlockRecord,
  decisionPriority: number,
  index: number,
  recordCount: number
): number {
  const fifoPriority = 1 - index / Math.max(1, recordCount);
  if (config.strategy.priorityMode === 'fifo') return fifoPriority;
  if (!config.useSPLQ && config.strategy.priorityMode === 'distance') return record.priority;
  if (!config.useSPLQ && config.strategy.priorityMode === 'lod') {
    return clamp(record.priority * 0.85 + fifoPriority * 0.15);
  }
  if (config.strategy.edgeReuse) {
    const cachedLayers = [
      record.state.sem === 'ready',
      record.state.coarse === 'ready',
      record.state.residual === 'ready'
    ].filter(Boolean).length / 3;
    return clamp(decisionPriority + cachedLayers * config.strategy.cacheReuseWeight);
  }
  return decisionPriority;
}

function residualPriorityMultiplier(): number {
  if (config.method === 'Seq-Load') return 1;
  if (config.strategy.semanticPriority) return 0.5;
  if (config.method === 'Std-LOD') return 0.7;
  return 0.62;
}

function refreshLocalPriorities(records: BlockRecord[]): void {
  const cameraPos = camera.position;
  let maxDistance = 0;
  for (const record of records) {
    record.cameraDistance = cameraPos.distanceTo(record.center);
    if (record.cameraDistance > maxDistance) maxDistance = record.cameraDistance;
  }
  for (const record of records) {
    const proximity = maxDistance > 0 ? 1 - record.cameraDistance / (maxDistance * 1.05) : 1;
    const semanticScore = config.strategy.semanticPriority ? (record.semantic?.semanticScore ?? 0.4) : 0;
    const proximityWeight = config.strategy.semanticPriority ? 0.55 : 1.0;
    const semanticWeight = config.strategy.semanticPriority ? 0.45 : 0;
    const cacheBonus = config.strategy.edgeReuse
      ? (
        (record.state.sem === 'ready' ? 1 : 0) +
        (record.state.coarse === 'ready' ? 1 : 0) +
        (record.state.residual === 'ready' ? 1 : 0)
      ) / 3 * config.strategy.cacheReuseWeight
      : 0;
    record.priority = clamp(proximity * proximityWeight + semanticScore * semanticWeight + cacheBonus);
  }
}

function isLayerUnlocked(record: BlockRecord, layer: LayerName): boolean {
  if (layer === 'sem') return true;
  if (layer === 'coarse') return true;
  if (!config.useSemantic) {
    return record.state.coarse === 'ready';
  }
  return record.state.coarse === 'ready';
}

function pickNextEntry(
  queue: SemanticPriorityLayerQueue,
  records: BlockRecord[],
  coarseReadyAt: Map<string, number>
): { record: BlockRecord; layer: LayerName } | undefined {
  if (config.method === 'Seq-Load') {
    for (const record of records) {
      if (record.state.coarse === 'loading' || record.state.residual === 'loading') return undefined;
      if (getCoarseUri(record.block) && record.state.coarse === 'idle') return { record, layer: 'coarse' };
      if (getResidualUri(record.block) && record.state.coarse === 'ready' && record.state.residual === 'idle') {
        return { record, layer: 'residual' };
      }
      if (getResidualUri(record.block) && record.state.residual !== 'ready') return undefined;
    }
    return undefined;
  }

  // Compute hasCoarseReady early so sem dispatch can be gated on it.
  const hasCoarseReady = records.some((r) => r.state.coarse === 'ready');

  const hasSemActiveOrReady = records.some(
    (record) => record.state.sem === 'ready' || record.state.sem === 'loading'
  );
  // Check 1 (early sem): only fire AFTER the first coarse block is rendered.
  // Dispatching sem before coarse1 is ready causes sem to steal bandwidth from
  // coarse1 on the critical path, inflating interaction_latency above Seq-Load.
  // Deferring sem means coarse1 gets 100% of bandwidth (same as Seq-Load), then
  // sem downloads immediately after and guides subsequent parallel downloads.
  if (config.useSemantic && config.strategy.semanticPriority && !hasSemActiveOrReady && hasCoarseReady) {
    const firstSem = [...records]
      .filter((record) => record.block.semantic && record.state.sem === 'idle')
      .sort((a, b) => {
        const left = lastDecisions.get(a.block.blockId)?.priority ?? a.priority;
        const right = lastDecisions.get(b.block.blockId)?.priority ?? b.priority;
        if (right !== left) return right - left;
        return a.block.blockId.localeCompare(b.block.blockId);
      })[0];
    if (firstSem) return { record: firstSem, layer: 'sem' };
  }

  const hasCoarseActiveOrReady = records.some(
    (record) => record.state.coarse === 'ready' || record.state.coarse === 'loading'
  );
  if (config.useSemantic && config.strategy.semanticPriority && !hasCoarseActiveOrReady) {
    const firstCoarse = [...records]
      .filter((record) => getCoarseUri(record.block) && record.state.coarse === 'idle')
      .sort((a, b) => {
        const left = lastDecisions.get(a.block.blockId)?.priority ?? a.priority;
        const right = lastDecisions.get(b.block.blockId)?.priority ?? b.priority;
        if (right !== left) return right - left;
        return a.block.blockId.localeCompare(b.block.blockId);
      })[0];
    if (firstCoarse) {
      if (lastDecisions.size > 0) markSemanticGuidedCoarseCandidate(metrics, firstCoarse.block.blockId);
      return { record: firstCoarse, layer: 'coarse' };
    }
  }

  if (!config.useSPLQ) {
    const sorted = [...records].sort((a, b) => {
      if (config.strategy.priorityMode === 'fifo') return records.indexOf(a) - records.indexOf(b);
      return b.priority - a.priority;
    });
    if (config.useSemantic && config.strategy.semanticPriority) {
      const sem = sorted.find((record) => record.block.semantic && record.state.sem === 'idle');
      if (sem) return { record: sem, layer: 'sem' };
    }
    const coarse = sorted.find((record) => getCoarseUri(record.block) && record.state.coarse === 'idle');
    if (coarse) return { record: coarse, layer: 'coarse' };
    const residual = sorted.find(
      (record) => getResidualUri(record.block) &&
        record.state.coarse === 'ready' &&
        record.state.residual === 'idle' &&
        residualDelaySatisfied(record, coarseReadyAt)
    );
    if (residual) return { record: residual, layer: 'residual' };
  }

  // T29 Fix A (final): first-screen serialization.
  //
  // hasCoarseReady is computed above (before Check 1) and reused here.
  //
  // Constraints while on the first screen (!hasCoarseReady):
  //   (a) Block ALL sem downloads — sem is deferred until after first coarse is
  //       rendered (Check 1 is also gated on hasCoarseReady above).  This gives
  //       coarse1 100% of the available bandwidth, matching Seq-Load performance.
  //   (b) Serialize coarse downloads at bandwidth-constrained links to prevent
  //       N-way splitting that degrades interaction_latency.
  //
  // After first coarse renders, all constraints lift and parallel operation resumes.
  const coarseLoadingCount = !hasCoarseReady
    ? records.filter((r) => r.state.coarse === 'loading').length
    : 0;

  const recordById = new Map(records.map((r) => [r.block.blockId, r]));
  for (const entry of queue.snapshot().entries) {
    const record = recordById.get(entry.blockId);
    if (!record) continue;
    if (record.state[entry.layer] !== 'idle') continue;
    if (entry.layer === 'residual' && !residualDelaySatisfied(record, coarseReadyAt)) continue;
    if (!isLayerUnlocked(record, entry.layer)) continue;
    // (a) First screen: block ALL sem until first coarse is rendered.
    if (entry.layer === 'sem' && !hasCoarseReady) continue;
    // (b) First screen: serialize coarse downloads ONLY at bandwidth-constrained links.
    //
    // At high bandwidth (≥~10 Mbps) coarse files (80 KB) transfer in <100 ms, so
    // serialization provides no benefit — it only adds JS tick-scheduling overhead
    // that makes Ours slower than MT-Web3DRC.  At low/medium bandwidth the
    // serialization is critical to prevent N-way splitting that degrades
    // interaction_latency.  Threshold: estimated download time ≥ 50 ms.
    const coarseKB = (record.block.bytes?.coarse ?? 80 * 1024) / 1024;
    const estCoarseMs = config.bandwidth > 0
      ? (coarseKB / (config.bandwidth * 128)) * 1000   // KB / (Mbps × 128 KB/Mbps) × 1000
      : Infinity;
    const bandwidthConstrained = estCoarseMs >= 50;     // ~≤13 Mbps for 80 KB coarse
    if (entry.layer === 'coarse' && !hasCoarseReady && coarseLoadingCount >= 1 && bandwidthConstrained) continue;
    if (entry.layer === 'coarse' && hasCoarseReady && lastDecisions.size > 0 && config.strategy.semanticPriority) {
      markSemanticGuidedCoarseCandidate(metrics, record.block.blockId);
    }
    return { record, layer: entry.layer };
  }
  return undefined;
}

function recordSemanticRankingEvidence(records: BlockRecord[], response: { items: ScheduleDecision[] }): void {
  if (!config.strategy.semanticPriority) return;
  const k = 3;
  const relevanceByBlockId: Record<string, number> = {};
  const semanticRanked = records
    .map((record) => {
      const semantic = record.semantic ?? record.block.semantic?.data;
      if (!semantic) return undefined;
      const saliencyScore = semantic.saliency.length > 0 ? mean(semantic.saliency.map((region) => clamp(region.score))) : 0;
      const taskRelevance = estimateTaskRelevance(semantic, config.taskLabels);
      const relevance = clamp(semantic.semanticScore * 0.5 + saliencyScore * 0.25 + taskRelevance * 0.25);
      relevanceByBlockId[record.block.blockId] = relevance;
      return { blockId: record.block.blockId, relevance };
    })
    .filter((item): item is { blockId: string; relevance: number } => item !== undefined)
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return a.blockId.localeCompare(b.blockId);
    });

  if (semanticRanked.length === 0) return;

  recordSemanticRankingSample(metrics, {
    scheduledTopK: response.items.slice(0, k).map((item) => item.blockId),
    semanticTopK: semanticRanked.slice(0, k).map((item) => item.blockId),
    relevanceByBlockId,
    k
  });
}

function residualDelaySatisfied(record: BlockRecord, coarseReadyAt: Map<string, number>): boolean {
  // 旋转期间使用更短的延迟，避免阻塞新视角的 coarse 加载
  const effectiveDelayMs = rotationState === 1
    ? Math.min(config.strategy.residualDelayMs, 200)
    : config.strategy.residualDelayMs;
  if (effectiveDelayMs <= 0) return true;
  const readyAt = coarseReadyAt.get(record.block.blockId);
  if (readyAt === undefined) return true;
  return performance.now() - readyAt >= effectiveDelayMs;
}

async function loadEntry(
  record: BlockRecord,
  layer: LayerName,
  loader: GltfLoader,
  coarseReadyAt: Map<string, number>
): Promise<void> {
  record.state[layer] = 'loading';
  const blockId = record.block.blockId;
  const decision = lastDecisions.get(blockId);
  const mode = decision?.mode ?? 'local';

  if (layer === 'sem') {
    const semUri = record.block.semantic?.manifestUri;
    if (!semUri) {
      record.state.sem = 'error';
      return;
    }
    const resourceUrl = sceneAssetUrl(semUri);
    const startedAt = recordLayerStart();
    try {
      const resp = await fetch(resourceUrl);
      if (!resp.ok) throw new Error(`sem fetch ${resp.status}`);
      const semData = await resp.json() as SemanticManifest;
      record.semantic = semData;
      record.state.sem = 'ready';
      const contentLength = resp.headers.get('content-length');
      const parsedContentLength = contentLength === null ? Number.NaN : Number.parseInt(contentLength, 10);
      const semanticBytes = measureResourceTransferBytes(
        resourceUrl,
        Number.isFinite(parsedContentLength) ? parsedContentLength : estimateSemanticBytes(semData)
      );
      record.semanticBytes = semanticBytes;
      recordLayerReady(metrics, 'sem', semanticBytes, blockId, startedAt, mode);
      recordBandwidthSaving(
        metrics,
        semanticBytes,
        (record.block.bytes?.coarse ?? 0) + (record.block.bytes?.residual ?? 0)
      );
      recordSemanticFidelity(metrics, estimateSemanticFidelityScore(semData, config.taskLabels));
      recordSemanticPriorityHit(metrics, config.strategy.semanticPriority && semData.semanticScore >= 0.7);
    } catch {
      record.state.sem = 'error';
    }
    return;
  }

  if (layer === 'coarse') {
    const uri = getCoarseUri(record.block);
    if (!uri) {
      record.state.coarse = 'error';
      return;
    }
    const startedAt = recordLayerStart();
    try {
      const resourceUrl = sceneAssetUrl(uri);
      const group = await loader.load(resourceUrl);
      record.group = group;
      rootGroup.add(group);
      record.state.coarse = 'ready';
      coarseReadyAt.set(blockId, performance.now());
      recordLayerReady(
        metrics,
        'coarse',
        measureResourceTransferBytes(resourceUrl, record.block.bytes?.coarse ?? 0),
        blockId,
        startedAt,
        mode
      );
    } catch (error) {
      record.state.coarse = 'error';
      throw error;
    }
    return;
  }

  if (layer === 'residual') {
    const uri = getResidualUri(record.block);
    if (!uri) {
      record.state.residual = 'error';
      return;
    }
    const startedAt = recordLayerStart();
    try {
      const resourceUrl = sceneAssetUrl(uri);
      const group = await loader.load(resourceUrl);
      if (record.group) rootGroup.remove(record.group);
      record.group = group;
      rootGroup.add(group);
      record.state.residual = 'ready';
      recordLayerReady(
        metrics,
        'residual',
        measureResourceTransferBytes(resourceUrl, record.block.bytes?.residual ?? 256),
        blockId,
        startedAt,
        mode
      );
    } catch (error) {
      record.state.residual = 'error';
      throw error;
    }
  }
}

function renderBlockSummary(manifest: SceneManifest, records: BlockRecord[]): void {
  const totalCoarseBytes = manifest.blocks.reduce((sum, block) => sum + (block.bytes?.coarse ?? 0), 0);
  const ready = records.filter((r) => r.state.coarse === 'ready').length;
  blockSummaryPanel.innerHTML = `
    <strong>${manifest.partition.blockCount}</strong> blocks
    <span style="color: #6a7f96;">${Math.round(totalCoarseBytes / 1024)} KB coarse</span>
    <span style="margin-left: 8px; color: #2f7a3d;">${ready} ready</span>
  `;

  const sorted = [...records].sort((a, b) => {
    const da = lastDecisions.get(a.block.blockId)?.priority ?? a.priority;
    const db = lastDecisions.get(b.block.blockId)?.priority ?? b.priority;
    return db - da;
  });
  blockTablePanel.innerHTML = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; color: #55697d;">
          <th style="padding: 8px 6px;">Block</th>
          <th style="padding: 8px 6px;">Mode</th>
          <th style="padding: 8px 6px;">Pri</th>
          <th style="padding: 8px 6px;">Layers</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
      .map((record) => {
        const decision = lastDecisions.get(record.block.blockId);
        const pri = decision?.priority ?? record.priority;
        const mode = decision?.mode ?? '—';
        return `
              <tr>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">
                  <strong>${record.block.blockId}</strong>
                  <div style="font-size: 12px; color: #6a7f96;">d=${record.cameraDistance.toFixed(2)}</div>
                </td>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">${mode}</td>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">${pri.toFixed(2)}</td>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">
                  ${layerBadge('sem', record.state.sem)} ${layerBadge('coarse', record.state.coarse)} ${layerBadge('residual', record.state.residual)}
                </td>
              </tr>
            `;
      })
      .join('')}
      </tbody>
    </table>
  `;
}

function layerBadge(name: LayerName, state: string): string {
  const color = state === 'ready' ? '#2f7a3d' : state === 'loading' ? '#b3791d' : state === 'error' ? '#a82a2a' : '#6a7f96';
  return `<span style="display:inline-block;padding:2px 6px;border-radius:6px;background:${color}1a;color:${color};font-size:11px;margin-right:4px;">${name}:${state}</span>`;
}

function renderQueuePanel(queue: SemanticPriorityLayerQueue): void {
  const snapshot = queue.snapshot();
  queueSummaryPanel.innerHTML = `
    <strong>${Math.round(snapshot.totalBytes / 1024)} KB</strong> / ${Math.round(snapshot.maxBytes / 1024)} KB budget
    <div style="margin-top: 6px; color: #55697d;">${snapshot.entries.length} entries enqueued</div>
  `;
  queueTablePanel.innerHTML = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; color: #55697d;">
          <th style="padding: 8px 6px;">Key</th>
          <th style="padding: 8px 6px;">Pri</th>
          <th style="padding: 8px 6px;">KB</th>
        </tr>
      </thead>
      <tbody>
        ${snapshot.entries
      .map(
        (entry: RuntimeQueueEntry) => `
              <tr>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);"><code>${entry.key}</code></td>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">${entry.priority.toFixed(2)}</td>
                <td style="padding: 8px 6px; border-top: 1px solid rgba(16,34,56,0.08);">${(entry.bytes / 1024).toFixed(1)}</td>
              </tr>
            `
      )
      .join('')}
      </tbody>
    </table>
  `;
}

function renderMetrics(): void {
  const ttfb = ttfbMs(metrics);
  const fsv = fsvMs(metrics);
  const bandwidthSaving = getStatistics(metrics, statisticsContext).bandwidthSaving.mean;
  const ttfbLine = ttfb === undefined ? 'pending' : `${ttfb.toFixed(0)} ms`;
  const fsvLine = fsv === undefined ? 'pending' : `${fsv.toFixed(0)} ms`;
  const total = totalLoadCount(metrics);
  const bytes = totalBytes(metrics);
  const avg = total === 0 ? 0 : bytes / total;
  const dist = metrics.modeDistribution;
  const distTotal = dist.SF + dist.EE + dist.FR || 1;
  metricsPanel.innerHTML = `
    <div><strong>Scheduler:</strong> ${schedulerOnline ? 'online' : 'offline / fallback'} (${metrics.scheduleRoundtrips} ok / ${metrics.scheduleFailures} fail)</div>
    <div style="margin-top: 4px;"><strong>FSV (first sem ready):</strong> ${fsvLine}</div>
    <div style="margin-top: 4px;"><strong>TTFB (first block ready):</strong> ${ttfbLine}</div>
    <div style="margin-top: 4px;"><strong>Layer hits:</strong>
      sem ${metrics.loadCountByLayer.sem} ·
      coarse ${metrics.loadCountByLayer.coarse} ·
      residual ${metrics.loadCountByLayer.residual}
    </div>
    <div style="margin-top: 4px;"><strong>Bytes transferred:</strong> ${(bytes / 1024).toFixed(1)} KB · avg ${(avg / 1024).toFixed(2)} KB/load</div>
    <div style="margin-top: 4px;"><strong>Bandwidth saving:</strong> ${(bandwidthSaving * 100).toFixed(1)}%</div>
    <div style="margin-top: 4px;"><strong>Mode dist:</strong>
      SF ${dist.SF} (${((dist.SF / distTotal) * 100).toFixed(0)}%) ·
      EE ${dist.EE} (${((dist.EE / distTotal) * 100).toFixed(0)}%) ·
      FR ${dist.FR} (${((dist.FR / distTotal) * 100).toFixed(0)}%)
    </div>
    <div style="margin-top: 4px;"><strong>View cycles:</strong> ${metrics.viewCycles.length} · events: ${metrics.layerEvents.length}</div>
    <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
      <button id="btn-export-summary" style="padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(16,34,56,0.18); background: #f0f4fa; cursor: pointer; font-size: 12px;">Export summary.csv</button>
      <button id="btn-export-events" style="padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(16,34,56,0.18); background: #f0f4fa; cursor: pointer; font-size: 12px;">Export events.csv</button>
      <button id="btn-export-cycles" style="padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(16,34,56,0.18); background: #f0f4fa; cursor: pointer; font-size: 12px;">Export viewcycles.csv</button>
    </div>
  `;
  document.getElementById('btn-export-summary')?.addEventListener('click', () => {
    triggerCsvDownload('mtweb_summary.csv', exportSummaryCsv(metrics));
  });
  document.getElementById('btn-export-events')?.addEventListener('click', () => {
    triggerCsvDownload('mtweb_layer_events.csv', exportLayerEventsCsv(metrics));
  });
  document.getElementById('btn-export-cycles')?.addEventListener('click', () => {
    triggerCsvDownload('mtweb_view_cycles.csv', exportViewCyclesCsv(metrics));
  });
}

function fitOrbitToBlocks(records: BlockRecord[]): void {
  if (records.length === 0) return;
  const aabb = new THREE.Box3();
  for (const record of records) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = record.block.bbox;
    aabb.expandByPoint(new THREE.Vector3(minX, minY, minZ));
    aabb.expandByPoint(new THREE.Vector3(maxX, maxY, maxZ));
  }
  const size = aabb.getSize(new THREE.Vector3());
  aabb.getCenter(orbitCenter);
  orbitRadius = Math.max(4.5, size.length() * 0.9);
}


function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function estimateSemanticBytes(semantic?: SemanticManifest): number {
  if (!semantic) return 512;
  return 512 + semantic.labels.length * 96 + semantic.saliency.length * 64 + semantic.thumbs.length * 160;
}

function estimateSemanticFidelityScore(semantic: SemanticManifest, taskLabels: string[]): number {
  const semanticScore = clamp(semantic.semanticScore);
  const labelScore = semantic.labels.length === 0
    ? 0
    : mean(semantic.labels.map((label) => clamp(label.score)));
  const saliencyScore = semantic.saliency.length === 0
    ? 0
    : mean(semantic.saliency.map((region) => clamp(region.score)));
  const thumbScore = semantic.thumbs.length > 0 ? 1 : 0;
  const taskMatches = taskLabels.filter((task) =>
    semantic.labels.some((label) => label.name.toLowerCase().includes(task.toLowerCase()))
  ).length;
  const taskScore = taskLabels.length === 0 ? 0 : taskMatches / taskLabels.length;
  return clamp(semanticScore * 0.4 + labelScore * 0.25 + saliencyScore * 0.15 + thumbScore * 0.1 + taskScore * 0.1);
}

function estimateTaskRelevance(semantic: SemanticManifest, taskLabels: string[]): number {
  const relevance = semantic.taskRelevance ?? semantic.taskScores;
  if (relevance && taskLabels.length > 0) {
    const scores = taskLabels
      .map((task) => relevance[task] ?? relevance[task.toLowerCase()])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (scores.length > 0) return mean(scores.map((score) => clamp(score)));
  }

  if (taskLabels.length === 0) return clamp(semantic.semanticScore);
  const matches = taskLabels.filter((task) =>
    semantic.labels.some((label) => label.name.toLowerCase().includes(task.toLowerCase()))
  ).length;
  return matches / taskLabels.length;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function measureResourceTransferBytes(url: string, fallbackBytes: number): number {
  const absoluteUrl = new URL(url, window.location.href).href;
  const entries = performance.getEntriesByName(absoluteUrl, 'resource') as PerformanceResourceTiming[];
  const entry = entries.length > 0 ? entries[entries.length - 1] : undefined;

  if (entry) {
    if (entry.transferSize > 0) return entry.transferSize;
    if (entry.encodedBodySize > 0) return entry.encodedBodySize;
    if (entry.decodedBodySize > 0) return entry.decodedBodySize;
  }

  return fallbackBytes;
}

function updateStatus(headline: string, detail: string): void {
  statusHeadline.textContent = headline;
  statusDetail.textContent = detail;
}

interface FetchedJson<T> {
  data: T;
  bytes: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<FetchedJson<T>> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  const text = await response.text();
  const contentLength = response.headers.get('content-length');
  const parsedContentLength = contentLength === null ? Number.NaN : Number.parseInt(contentLength, 10);
  const fallbackBytes = Number.isFinite(parsedContentLength) ? parsedContentLength : new Blob([text]).size;
  return {
    data: JSON.parse(text) as T,
    bytes: measureResourceTransferBytes(url, fallbackBytes)
  };
}

function sceneAssetUrl(relativePath: string): string {
  return `${config.sceneRoot}/${relativePath}`.replace(/\/{2,}/g, '/');
}

function inferSceneId(sceneRoot: string): string {
  const parts = sceneRoot.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(window as any).experimentMetrics = {
  getStatistics: () => getStatistics(metrics, statisticsContext)
};
