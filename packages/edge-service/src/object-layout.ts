import type { LayerName } from '@mtweb/shared-contracts';

export interface ObjectCoordinate {
  sceneId: string;
  blockId: string;
  layer: LayerName;
  version?: string;
}

const LAYER_OBJECT_NAME: Record<LayerName, string> = {
  sem: 'sem.json',
  coarse: 'coarse/lod1.glb',
  residual: 'residual/manifest.json'
};

export function buildCacheKey(coord: ObjectCoordinate): string {
  const version = coord.version ?? 'v0';
  return `scene:${coord.sceneId}:block:${coord.blockId}:layer:${coord.layer}:ver:${version}`;
}

export function parseCacheKey(key: string): ObjectCoordinate | undefined {
  const parts = key.split(':');
  if (parts.length !== 8) return undefined;
  const [, sceneId, , blockId, , layer, , version] = parts;
  if (layer !== 'sem' && layer !== 'coarse' && layer !== 'residual') return undefined;
  return { sceneId, blockId, layer, version };
}

export function buildObjectUri(coord: ObjectCoordinate): string {
  return `${coord.sceneId}/${coord.blockId}/${LAYER_OBJECT_NAME[coord.layer]}`;
}
