import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlockManifest, SceneManifest, SemanticManifest } from '@mtweb/shared-contracts';
import type { PreprocessConfig } from '../config.js';
import type { ExportedBlockArtifact } from '../adapters/gltf-transform-adapter.js';

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function ruleGeneratedSemanticManifest(block: ExportedBlockArtifact, coarseBytes: number): SemanticManifest {
  const [minX, minY, minZ, maxX, maxY, maxZ] = block.bbox;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
  const nodeFactor = clamp(block.nodeCount / 8);
  const byteFactor = clamp((block.coarseBytes + block.residualBytes) / (512 * 1024));
  const semanticScore = clamp(0.42 + nodeFactor * 0.33 + byteFactor * 0.2);
  const labelBase = block.nodeCount > 1 ? 'multi-part geometry' : 'geometry block';
  const inspectScore = clamp(semanticScore * 0.75 + byteFactor * 0.25);
  const overviewScore = clamp(0.5 + extent / (extent + 4) * 0.3);

  return {
    blockId: block.blockId,
    bbox: block.bbox,
    labels: [
      { name: labelBase, score: clamp(0.55 + nodeFactor * 0.35) },
      { name: 'visible surface', score: clamp(0.5 + byteFactor * 0.35) }
    ],
    saliency: [
      {
        bbox: [0.18, 0.18, 0.82, 0.82],
        score: clamp(0.45 + semanticScore * 0.45)
      }
    ],
    thumbs: [`${block.blockId}/sem/thumb_0.webp`],
    semanticScore,
    taskRelevance: {
      overview: overviewScore,
      inspect: inspectScore,
      navigation: clamp(0.45 + (1 - nodeFactor) * 0.25)
    },
    taskLabels: ['overview', 'inspect', 'navigation'],
    taskScores: {
      overview: overviewScore,
      inspect: inspectScore,
      navigation: clamp(0.45 + (1 - nodeFactor) * 0.25)
    },
    metadata: {
      source: 'rule_generated',
      generator: 'preprocess.ruleGeneratedSemanticManifest',
      generatedAt: new Date().toISOString()
    },
    lods: {
      coarse: block.coarseUri,
      residual: [block.residualUri]
    },
    bytes: {
      coarse: coarseBytes,
      residual: block.residualBytes
    }
  };
}

export async function writeStarterSceneManifest(config: PreprocessConfig, blocks: ExportedBlockArtifact[]): Promise<string> {
  const manifestDir = path.join(config.outputRoot, 'manifest');
  const manifestPath = path.join(manifestDir, 'blocks.json');
  
  const blockEntries: BlockManifest[] = await Promise.all(blocks.map(async (block) => {
    let semanticData: SemanticManifest | undefined;
    if (config.generateSemanticPlaceholders) {
      const coarsePath = path.join(config.outputRoot, block.coarseUri);
      const coarseStats = await stat(coarsePath);
      semanticData = ruleGeneratedSemanticManifest(block, coarseStats.size);
    }

    return {
      blockId: block.blockId,
      bbox: block.bbox,
      center: block.center,
      bytes: {
        coarse: block.coarseBytes,
        residual: block.residualBytes
      },
      layers: {
        coarse: block.coarseUri,
        residual: block.residualUri
      },
      semantic: config.generateSemanticPlaceholders && semanticData
        ? {
            manifestUri: `${block.blockId}/sem/sem.json`,
            thumbUris: [`${block.blockId}/sem/thumb_0.webp`],
            data: semanticData
          }
        : undefined
    };
  }));

  const manifest: SceneManifest = {
    schemaVersion: '0.1.0',
    sceneId: config.sceneId,
    createdAt: new Date().toISOString(),
    partition: {
      mode: config.partitionMode,
      blockCount: blockEntries.length
    },
    blocks: blockEntries
  };

  await mkdir(manifestDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

export async function writeStarterScheduleProfile(config: PreprocessConfig): Promise<string> {
  const manifestDir = path.join(config.outputRoot, 'manifest');
  const profilePath = path.join(manifestDir, 'schedule_profile.json');
  const profile = {
    sceneId: config.sceneId,
    createdAt: new Date().toISOString(),
    defaults: {
      sfBias: 0.65,
      eeBias: 0.55,
      frBias: 0.45
    }
  };

  await mkdir(manifestDir, { recursive: true });
  await writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  return profilePath;
}

export async function writeStarterSemanticManifest(
  outputRoot: string,
  block: ExportedBlockArtifact
): Promise<string> {
  const semDir = path.join(outputRoot, block.blockId, 'sem');
  const semPath = path.join(semDir, 'sem.json');
  const coarsePath = path.join(outputRoot, block.coarseUri);
  const coarseStats = await stat(coarsePath);

  const sem = ruleGeneratedSemanticManifest(block, coarseStats.size);

  await mkdir(semDir, { recursive: true });
  await writeFile(semPath, JSON.stringify(sem, null, 2), 'utf8');
  return semPath;
}
