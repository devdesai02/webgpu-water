import type { Mat4 } from 'wgpu-matrix';

export interface PipelineConfig {
  pipeline: GPURenderPipeline;
  uniformSize: number;
  uniformBuffer: GPUBuffer;
}

export interface CubemapURLs {
  xpos: string;
  xneg: string;
  ypos: string;
  yneg: string;
  zpos: string;
  zneg: string;
}

export interface MatricesPair {
  projectionMatrix: Mat4;
  viewMatrix: Mat4;
}

export const enum InteractionMode {
  None = -1,
  AddDrops = 0,
  OrbitCamera = 1,
  MoveSphere = 2,
}

export type Viewport = [number, number, number, number];
