#!/usr/bin/env node
/**
 * expand_scene.mjs
 * 将 demo-scene 从 2 个 block 扩展到 12 个 block。
 * 策略：复用现有两个 GLB 文件，通过 bytes 字段模拟不同大小，
 * 为每个 block 生成有区分度的 sem.json（semanticScore 0.30–0.92）。
 */

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE_ROOT = path.resolve(__dirname, '../scenes/processed/demo-scene');
const PUBLIC_SCENE_ROOT = path.resolve(__dirname, '../packages/web-client/public/scenes/demo-scene');
const DIST_SCENE_ROOT = path.resolve(__dirname, '../packages/web-client/dist/scenes/demo-scene');
const NODE_MODULES_PUBLIC_SCENE_ROOT = path.resolve(__dirname, '../node_modules/@mtweb/web-client/public/scenes/demo-scene');
const NODE_MODULES_DIST_SCENE_ROOT = path.resolve(__dirname, '../node_modules/@mtweb/web-client/dist/scenes/demo-scene');
const BLOCK_COUNT = 12;

// 场景在 XZ 平面上铺开，3 列 × 4 行，每格 2×2 单位
const GRID_COLS = 3;
const GRID_ROWS = 4;
const CELL_W = 2.0;
const CELL_D = 2.0;
const CELL_H = 2.0; // Y 方向固定 [-1, 1]

// 每个 block 的语义配置（差异化）
const BLOCK_CONFIGS = [
  { semanticScore: 0.92, labels: [{ name: 'building', score: 0.91 }, { name: 'wall', score: 0.78 }], saliency: [{ bbox: [0.1, 0.1, 0.6, 0.7], score: 0.88 }], coarseMult: 8.2, residualMult: 6.5 },
  { semanticScore: 0.85, labels: [{ name: 'door', score: 0.87 }, { name: 'frame', score: 0.72 }], saliency: [{ bbox: [0.2, 0.15, 0.55, 0.8], score: 0.82 }], coarseMult: 6.8, residualMult: 5.4 },
  { semanticScore: 0.78, labels: [{ name: 'window', score: 0.80 }, { name: 'glass', score: 0.65 }], saliency: [{ bbox: [0.15, 0.2, 0.5, 0.75], score: 0.76 }], coarseMult: 5.5, residualMult: 4.2 },
  { semanticScore: 0.71, labels: [{ name: 'column', score: 0.74 }, { name: 'pillar', score: 0.68 }], saliency: [{ bbox: [0.3, 0.1, 0.65, 0.85], score: 0.70 }], coarseMult: 4.8, residualMult: 3.8 },
  { semanticScore: 0.65, labels: [{ name: 'floor', score: 0.70 }, { name: 'tile', score: 0.55 }], saliency: [{ bbox: [0.05, 0.05, 0.9, 0.4], score: 0.62 }], coarseMult: 4.2, residualMult: 3.3 },
  { semanticScore: 0.60, labels: [{ name: 'ceiling', score: 0.63 }, { name: 'beam', score: 0.52 }], saliency: [{ bbox: [0.1, 0.6, 0.85, 0.95], score: 0.58 }], coarseMult: 3.8, residualMult: 3.0 },
  { semanticScore: 0.55, labels: [{ name: 'stair', score: 0.58 }, { name: 'step', score: 0.48 }], saliency: [{ bbox: [0.2, 0.3, 0.7, 0.9], score: 0.53 }], coarseMult: 3.4, residualMult: 2.7 },
  { semanticScore: 0.50, labels: [{ name: 'furniture', score: 0.52 }], saliency: [{ bbox: [0.25, 0.2, 0.65, 0.75], score: 0.48 }], coarseMult: 3.0, residualMult: 2.4 },
  { semanticScore: 0.45, labels: [{ name: 'pipe', score: 0.47 }, { name: 'duct', score: 0.40 }], saliency: [{ bbox: [0.1, 0.1, 0.4, 0.5], score: 0.43 }], coarseMult: 2.6, residualMult: 2.1 },
  { semanticScore: 0.40, labels: [{ name: 'wall', score: 0.42 }], saliency: [{ bbox: [0.0, 0.0, 1.0, 0.3], score: 0.38 }], coarseMult: 2.2, residualMult: 1.8 },
  { semanticScore: 0.35, labels: [{ name: 'ground', score: 0.37 }], saliency: [{ bbox: [0.0, 0.7, 1.0, 1.0], score: 0.33 }], coarseMult: 1.8, residualMult: 1.5 },
  { semanticScore: 0.30, labels: [{ name: 'background', score: 0.31 }], saliency: [], coarseMult: 1.4, residualMult: 1.2 },
];

// 基础 GLB 字节数（来自原始 block_0001）
const BASE_COARSE_BYTES = 1220;
const BASE_RESIDUAL_BYTES = 1060;

// 原始 GLB 文件路径（交替使用两个）
const SOURCE_GLBS = [
  { coarse: path.join(SCENE_ROOT, 'block_0001/coarse/lod1.glb'), residual: path.join(SCENE_ROOT, 'block_0001/residual/lod2.glb') },
  { coarse: path.join(SCENE_ROOT, 'block_0002/coarse/lod1.glb'), residual: path.join(SCENE_ROOT, 'block_0002/residual/lod2.glb') },
];

async function main() {
  const blocks = [];
  const sourceFiles = await Promise.all(
    SOURCE_GLBS.map(async (src, index) => {
      const copyRoot = path.join(SCENE_ROOT, `.expand_sources_${index + 1}`);
      await mkdir(path.join(copyRoot, 'coarse'), { recursive: true });
      await mkdir(path.join(copyRoot, 'residual'), { recursive: true });
      const coarse = path.join(copyRoot, 'coarse/lod1.glb');
      const residual = path.join(copyRoot, 'residual/lod2.glb');
      await copyFile(src.coarse, coarse);
      await copyFile(src.residual, residual);
      return { coarse, residual };
    })
  );

  for (let i = 0; i < BLOCK_COUNT; i++) {
    const blockId = `block_${String(i + 1).padStart(4, '0')}`;
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const cfg = BLOCK_CONFIGS[i];

    // 计算 bbox（XZ 平面网格，Y 固定 [-1, 1]）
    const xMin = col * CELL_W - (GRID_COLS * CELL_W) / 2;
    const xMax = xMin + CELL_W;
    const zMin = row * CELL_D - (GRID_ROWS * CELL_D) / 2;
    const zMax = zMin + CELL_D;
    const bbox = [xMin, -1, zMin, xMax, 1, zMax];
    const center = [(xMin + xMax) / 2, 0, (zMin + zMax) / 2];

    const coarseBytes = Math.round(BASE_COARSE_BYTES * cfg.coarseMult);
    const residualBytes = Math.round(BASE_RESIDUAL_BYTES * cfg.residualMult);

    // 目录
    const blockDir = path.join(SCENE_ROOT, blockId);
    const coarseDir = path.join(blockDir, 'coarse');
    const residualDir = path.join(blockDir, 'residual');
    const semDir = path.join(blockDir, 'sem');
    await mkdir(coarseDir, { recursive: true });
    await mkdir(residualDir, { recursive: true });
    await mkdir(semDir, { recursive: true });

    // 复制 GLB（交替使用两个源文件）
    const src = sourceFiles[i % sourceFiles.length];
    await copyFile(src.coarse, path.join(coarseDir, 'lod1.glb'));
    await copyFile(src.residual, path.join(residualDir, 'lod2.glb'));

    // 写 sem.json
    const sem = {
      blockId,
      bbox,
      labels: cfg.labels,
      saliency: cfg.saliency,
      thumbs: [`${blockId}/sem/thumb_0.webp`],
      semanticScore: cfg.semanticScore,
      lods: {
        coarse: `${blockId}/coarse/lod1.glb`,
        residual: [`${blockId}/residual/lod2.glb`]
      },
      bytes: { coarse: coarseBytes, residual: residualBytes }
    };
    await writeFile(path.join(semDir, 'sem.json'), JSON.stringify(sem, null, 2), 'utf8');

    blocks.push({
      blockId,
      bbox,
      center,
      bytes: { coarse: coarseBytes, residual: residualBytes },
      layers: {
        coarse: `${blockId}/coarse/lod1.glb`,
        residual: `${blockId}/residual/lod2.glb`
      },
      semantic: {
        manifestUri: `${blockId}/sem/sem.json`,
        thumbUris: [`${blockId}/sem/thumb_0.webp`]
      }
    });

    console.log(`[expand] ${blockId} semanticScore=${cfg.semanticScore} coarse=${coarseBytes}B residual=${residualBytes}B`);
  }

  // 写 blocks.json
  const manifest = {
    schemaVersion: '0.1.0',
    sceneId: 'demo-scene',
    createdAt: new Date().toISOString(),
    partition: { mode: 'aabb-grid', blockCount: BLOCK_COUNT },
    blocks
  };
  const manifestPath = path.join(SCENE_ROOT, 'manifest/blocks.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[expand] wrote ${manifestPath} with ${BLOCK_COUNT} blocks`);

  await Promise.all(sourceFiles.map((src) => rm(path.dirname(path.dirname(src.coarse)), { recursive: true, force: true })));
  await mirrorScene(PUBLIC_SCENE_ROOT, manifest);
  await mirrorScene(DIST_SCENE_ROOT, manifest);
  await mirrorScene(NODE_MODULES_PUBLIC_SCENE_ROOT, manifest);
  await mirrorScene(NODE_MODULES_DIST_SCENE_ROOT, manifest);

  console.log('[expand] done.');
}

async function mirrorScene(targetRoot, manifest) {
  try {
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(path.join(targetRoot, 'manifest'), { recursive: true });
    for (const block of manifest.blocks) {
      const blockId = block.blockId;
      await mkdir(path.join(targetRoot, blockId, 'coarse'), { recursive: true });
      await mkdir(path.join(targetRoot, blockId, 'residual'), { recursive: true });
      await mkdir(path.join(targetRoot, blockId, 'sem'), { recursive: true });
      await copyFile(
        path.join(SCENE_ROOT, blockId, 'coarse/lod1.glb'),
        path.join(targetRoot, blockId, 'coarse/lod1.glb')
      );
      await copyFile(
        path.join(SCENE_ROOT, blockId, 'residual/lod2.glb'),
        path.join(targetRoot, blockId, 'residual/lod2.glb')
      );
      await copyFile(
        path.join(SCENE_ROOT, blockId, 'sem/sem.json'),
        path.join(targetRoot, blockId, 'sem/sem.json')
      );
    }
    await writeFile(path.join(targetRoot, 'manifest/blocks.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await copyFile(
      path.join(SCENE_ROOT, 'manifest/schedule_profile.json'),
      path.join(targetRoot, 'manifest/schedule_profile.json')
    );
    console.log(`[expand] mirrored scene to ${targetRoot}`);
  } catch (error) {
    console.warn(`[expand] could not mirror to ${targetRoot}: ${error.message}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
