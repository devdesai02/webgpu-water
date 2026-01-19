import { mat4, vec3 } from 'wgpu-matrix';
import { Pool } from './pool';
import { Sphere } from './sphere';
import { Water } from './water';
import { Vector, Raytracer } from './lightgl';
import { Cubemap } from './cubemap';
import { InteractionMode } from './types';
import type { MatricesPair, Viewport } from './types';

async function init(): Promise<void> {
  const gpu = navigator.gpu;
  if (!gpu) {
    document.getElementById('loading')!.innerHTML = 'WebGPU not supported.';
    return;
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    document.getElementById('loading')!.innerHTML = 'No WebGPU adapter found.';
    return;
  }

  const requiredFeatures: GPUFeatureName[] = [];
  if (adapter.features.has('float32-filterable')) {
    requiredFeatures.push('float32-filterable');
  }

  const device = await adapter.requestDevice({ requiredFeatures });
  const canvas = document.querySelector('canvas')!;
  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format, alphaMode: 'premultiplied' });

  const help = document.getElementById('help')!;
  const ratio = window.devicePixelRatio || 1;
  let prevTime = performance.now();

  // Load texture helper
  async function loadTexture(url: string): Promise<GPUTexture> {
    const res = await fetch(url);
    const blob = await res.blob();
    const source = await createImageBitmap(blob);

    const texture = device.createTexture({
      label: url,
      size: [source.width, source.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source, flipY: true },
      { texture },
      { width: source.width, height: source.height }
    );

    return texture;
  }

  const base = import.meta.env.BASE_URL as string;

  // Load textures
  const tileTexture = await loadTexture(`${base}tiles.jpg`);
  const tileSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  const cubemap = new Cubemap(device);
  const skyTexture = await cubemap.load({
    xpos: `${base}xpos.jpg`, xneg: `${base}xneg.jpg`,
    ypos: `${base}ypos.jpg`, yneg: `${base}yneg.jpg`,
    zpos: `${base}zpos.jpg`, zneg: `${base}zneg.jpg`
  });
  const skySampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  // Camera state
  let angleX = -25;
  let angleY = -200.5;

  function getMatrices(): MatricesPair {
    const aspect = canvas.width / canvas.height;
    const projectionMatrix = mat4.perspective(Math.PI / 4, aspect, 0.01, 100);

    const viewMatrix = mat4.identity();
    mat4.translate(viewMatrix, [0, 0, -4], viewMatrix);
    mat4.rotateX(viewMatrix, -angleX * Math.PI / 180, viewMatrix);
    mat4.rotateY(viewMatrix, -angleY * Math.PI / 180, viewMatrix);
    mat4.translate(viewMatrix, [0, 0.5, 0], viewMatrix);

    return { projectionMatrix, viewMatrix };
  }

  // Create uniform buffers
  const uniformBuffer = device.createBuffer({
    size: 80, // mat4 (64) + vec3 + padding (16)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const lightUniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const sphereUniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shadowUniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Initialize lighting
  let lightDir = new Vector(2.0, 2.0, -1.0).unit();

  function updateLight(): void {
    device.queue.writeBuffer(lightUniformBuffer, 0, new Float32Array([...lightDir.toArray(), 0]));
  }
  updateLight();

  // Initialize shadows (all enabled)
  device.queue.writeBuffer(shadowUniformBuffer, 0, new Float32Array([1.0, 1.0, 1.0, 0.0]));

  // Create scene objects
  const pool = new Pool(device, format, uniformBuffer, tileTexture, tileSampler, lightUniformBuffer, sphereUniformBuffer, shadowUniformBuffer);
  const sphere = new Sphere(device, format, uniformBuffer, lightUniformBuffer, sphereUniformBuffer);
  const water = new Water(device, 256, 256, uniformBuffer, lightUniformBuffer, sphereUniformBuffer, shadowUniformBuffer, tileTexture, tileSampler, skyTexture, skySampler);

  // Sphere physics state
  let center = new Vector(-0.4, -0.75, 0.2);
  let oldCenter = center.clone();
  const radius = 0.25;
  let velocity = new Vector();
  const gravity = new Vector(0, -4, 0);
  let useSpherePhysics = false;
  let paused = false;

  sphere.update(center.toArray(), radius);

  // Add initial drops
  for (let i = 0; i < 20; i++) {
    water.addDrop(Math.random() * 2 - 1, Math.random() * 2 - 1, 0.03, (i & 1) ? 0.01 : -0.01);
  }

  // Keyboard handling
  const keys: Record<string, boolean> = {};

  window.addEventListener('keydown', (e) => {
    const key = e.key.toUpperCase();
    keys[key] = true;
    if (key === 'G') useSpherePhysics = !useSpherePhysics;
    else if (key === ' ') paused = !paused;
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toUpperCase()] = false;
  });

  // Mouse interaction state
  let mode: InteractionMode = InteractionMode.None;
  let oldX = 0, oldY = 0;
  let prevHit: Vector;
  let planeNormal: Vector;

  function getViewport(): Viewport {
    return [0, 0, canvas.width, canvas.height];
  }

  function startDrag(x: number, y: number): void {
    oldX = x;
    oldY = y;
    const { projectionMatrix, viewMatrix } = getMatrices();
    const tracer = new Raytracer(viewMatrix, projectionMatrix, getViewport());
    const ray = tracer.getRayForPixel(x * ratio, y * ratio);

    // Check sphere hit
    const sphereHit = Raytracer.hitTestSphere(tracer.eye, ray, center, radius);
    if (sphereHit) {
      mode = InteractionMode.MoveSphere;
      prevHit = sphereHit.hit;
      planeNormal = tracer.getRayForPixel(canvas.width / 2, canvas.height / 2).negative();
      return;
    }

    // Check water hit
    const tPlane = -tracer.eye.y / ray.y;
    const pointOnPlane = tracer.eye.add(ray.multiply(tPlane));

    if (Math.abs(pointOnPlane.x) < 1 && Math.abs(pointOnPlane.z) < 1) {
      mode = InteractionMode.AddDrops;
      water.addDrop(pointOnPlane.x, pointOnPlane.z, 0.03, 0.01);
    } else {
      mode = InteractionMode.OrbitCamera;
    }
  }

  function duringDrag(x: number, y: number): void {
    if (mode === InteractionMode.OrbitCamera) {
      angleY -= x - oldX;
      angleX -= y - oldY;
      angleX = Math.max(-89.999, Math.min(89.999, angleX));
    } else if (mode === InteractionMode.MoveSphere) {
      const { projectionMatrix, viewMatrix } = getMatrices();
      const tracer = new Raytracer(viewMatrix, projectionMatrix, getViewport());
      const ray = tracer.getRayForPixel(x * ratio, y * ratio);

      const t = -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
      const nextHit = tracer.eye.add(ray.multiply(t));

      center = center.add(nextHit.subtract(prevHit));
      center.x = Math.max(radius - 1, Math.min(1 - radius, center.x));
      center.y = Math.max(radius - 1, Math.min(10, center.y));
      center.z = Math.max(radius - 1, Math.min(1 - radius, center.z));

      sphere.update(center.toArray(), radius);
      prevHit = nextHit;
    } else if (mode === InteractionMode.AddDrops) {
      const { projectionMatrix, viewMatrix } = getMatrices();
      const tracer = new Raytracer(viewMatrix, projectionMatrix, getViewport());
      const ray = tracer.getRayForPixel(x * ratio, y * ratio);
      const tPlane = -tracer.eye.y / ray.y;
      const pointOnPlane = tracer.eye.add(ray.multiply(tPlane));

      if (Math.abs(pointOnPlane.x) < 1 && Math.abs(pointOnPlane.z) < 1) {
        water.addDrop(pointOnPlane.x, pointOnPlane.z, 0.03, 0.01);
      }
    }
    oldX = x;
    oldY = y;
  }

  function stopDrag(): void {
    mode = InteractionMode.None;
  }

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startDrag(e.offsetX, e.offsetY);
  });

  window.addEventListener('mousemove', (e) => {
    if (mode !== InteractionMode.None) {
      const rect = canvas.getBoundingClientRect();
      duringDrag(e.clientX - rect.left, e.clientY - rect.top);
    }
  });

  window.addEventListener('mouseup', stopDrag);

  // Depth texture for rendering
  let depthTexture: GPUTexture;

  function onResize(): void {
    const width = window.innerWidth - help.clientWidth - 20;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    render();
  }

  window.addEventListener('resize', onResize);
  document.getElementById('loading')!.innerHTML = '';
  onResize();

  function updateUniforms(): void {
    const { projectionMatrix, viewMatrix } = getMatrices();
    const viewProjectionMatrix = mat4.multiply(projectionMatrix, viewMatrix);

    const invView = mat4.invert(viewMatrix);
    const eyeVec = vec3.transformMat4([0, 0, 0], invView);

    const uniformData = new Float32Array(20);
    uniformData.set(viewProjectionMatrix, 0);
    uniformData.set(eyeVec, 16);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  }

  function render(): void {
    const time = performance.now();
    let seconds = (time - prevTime) / 1000;
    prevTime = time;
    if (seconds > 1) seconds = 1;

    if (keys['L']) {
      lightDir = Vector.fromAngles((90 - angleY) * Math.PI / 180, -angleX * Math.PI / 180);
      updateLight();
    }

    if (!paused) {
      // Physics update
      if (mode === InteractionMode.MoveSphere) {
        velocity = new Vector();
      } else if (useSpherePhysics) {
        const percentUnderWater = Math.max(0, Math.min(1, (radius - center.y) / (2 * radius)));
        velocity = velocity.add(gravity.multiply(seconds - 1.1 * seconds * percentUnderWater));
        velocity = velocity.subtract(velocity.unit().multiply(percentUnderWater * seconds * velocity.dot(velocity)));
        center = center.add(velocity.multiply(seconds));

        if (center.y < radius - 1) {
          center.y = radius - 1;
          velocity.y = Math.abs(velocity.y) * 0.7;
        }

        sphere.update(center.toArray(), radius);
      }

      water.moveSphere(oldCenter.toArray(), center.toArray(), radius);
      oldCenter = center.clone();

      water.stepSimulation();
      water.stepSimulation();
      water.updateNormals();
      water.updateCaustics();
    }

    updateUniforms();

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      }
    });

    pool.render(passEncoder, water.textureA, water.sampler, water.causticsTexture);
    sphere.render(passEncoder, water.textureA, water.sampler, water.causticsTexture);
    water.renderSurface(passEncoder);

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  function animate(): void {
    requestAnimationFrame(animate);
    render();
  }

  requestAnimationFrame(animate);
}

init();
