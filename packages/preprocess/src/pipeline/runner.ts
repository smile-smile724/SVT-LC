import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { PreprocessConfig } from '../config.js';
import { ScenePartitionGltfTransformAdapter } from '../adapters/gltf-transform-adapter.js';
import {
  writeStarterSceneManifest,
  writeStarterScheduleProfile,
  writeStarterSemanticManifest
} from './manifest.js';

export async function loadConfig(configPath: string): Promise<PreprocessConfig> {
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw) as PreprocessConfig;
}

export async function runPreprocess(config: PreprocessConfig): Promise<void> {
  const adapter = new ScenePartitionGltfTransformAdapter();

  await mkdir(config.outputRoot, { recursive: true });
  await adapter.inspectScene(config.rawScenePath, config);
  const exportedBlocks = await adapter.exportBlocks(config.rawScenePath, config.outputRoot, config);

  const manifestPath = await writeStarterSceneManifest(config, exportedBlocks);
  const profilePath = await writeStarterScheduleProfile(config);

  if (config.generateSemanticPlaceholders) {
    for (const block of exportedBlocks) {
      await writeStarterSemanticManifest(config.outputRoot, block);
    }
  }

  console.log(`[preprocess] wrote scene manifest: ${manifestPath}`);
  console.log(`[preprocess] wrote starter schedule profile: ${profilePath}`);

  if (config.publicMirrorRoot) {
    await rm(config.publicMirrorRoot, { recursive: true, force: true });
    await cp(config.outputRoot, config.publicMirrorRoot, { recursive: true, force: true });
    console.log(`[preprocess] mirrored processed scene to web-client public assets: ${config.publicMirrorRoot}`);
  }

  console.log(`[preprocess] block export pipeline is ready for the next step: add semantic inference and residual LOD generation`);
}

export function resolveOutputRoot(projectRoot: string, relativeOutputRoot: string): string {
  return path.resolve(projectRoot, relativeOutputRoot);
}
