import type { CubemapURLs } from './types';

export class Cubemap {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async load(urls: CubemapURLs): Promise<GPUTexture> {
    const faces: (keyof CubemapURLs)[] = ['xpos', 'xneg', 'ypos', 'yneg', 'zpos', 'zneg'];

    const images = await Promise.all(
      faces.map(face => fetch(urls[face]).then(r => r.blob()).then(b => createImageBitmap(b)))
    );

    const { width, height } = images[0];

    const texture = this.device.createTexture({
      size: [width, height, 6],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    images.forEach((image, i) => {
      this.device.queue.copyExternalImageToTexture(
        { source: image, flipY: true },
        { texture, origin: [0, 0, i] },
        { width, height }
      );
    });

    return texture;
  }
}
