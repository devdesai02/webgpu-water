// Ported from lightgl.js - http://github.com/evanw/lightgl.js/

import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4 } from 'wgpu-matrix';
import type { Viewport } from './types';

export class Vector {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  negative(): Vector {
    return new Vector(-this.x, -this.y, -this.z);
  }

  add(v: Vector | number): Vector {
    if (v instanceof Vector) {
      return new Vector(this.x + v.x, this.y + v.y, this.z + v.z);
    }
    return new Vector(this.x + v, this.y + v, this.z + v);
  }

  subtract(v: Vector | number): Vector {
    if (v instanceof Vector) {
      return new Vector(this.x - v.x, this.y - v.y, this.z - v.z);
    }
    return new Vector(this.x - v, this.y - v, this.z - v);
  }

  multiply(v: Vector | number): Vector {
    if (v instanceof Vector) {
      return new Vector(this.x * v.x, this.y * v.y, this.z * v.z);
    }
    return new Vector(this.x * v, this.y * v, this.z * v);
  }

  divide(v: Vector | number): Vector {
    if (v instanceof Vector) {
      return new Vector(this.x / v.x, this.y / v.y, this.z / v.z);
    }
    return new Vector(this.x / v, this.y / v, this.z / v);
  }

  dot(v: Vector): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector): Vector {
    return new Vector(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  length(): number {
    return Math.sqrt(this.dot(this));
  }

  unit(): Vector {
    return this.divide(this.length());
  }

  min(): number {
    return Math.min(this.x, this.y, this.z);
  }

  max(): number {
    return Math.max(this.x, this.y, this.z);
  }

  toArray(): number[] {
    return [this.x, this.y, this.z];
  }

  clone(): Vector {
    return new Vector(this.x, this.y, this.z);
  }

  static fromAngles(theta: number, phi: number): Vector {
    return new Vector(
      Math.cos(phi) * Math.cos(theta),
      Math.sin(phi),
      Math.cos(phi) * Math.sin(theta)
    );
  }

  static lerp(a: Vector, b: Vector, t: number): Vector {
    return a.add(b.subtract(a).multiply(t));
  }

  static min(a: Vector, b: Vector): Vector {
    return new Vector(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  }

  static max(a: Vector, b: Vector): Vector {
    return new Vector(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }
}

export class HitTest {
  t: number;
  hit: Vector;
  normal: Vector;

  constructor(t: number, hit: Vector, normal: Vector) {
    this.t = t;
    this.hit = hit;
    this.normal = normal;
  }
}

export class Raytracer {
  eye: Vector;
  private viewport: Viewport;
  private invViewProj: Mat4;
  private ray00: Vector;
  private ray10: Vector;
  private ray01: Vector;
  private ray11: Vector;

  constructor(viewMatrix: Mat4, projectionMatrix: Mat4, viewport: Viewport) {
    this.viewport = viewport;

    // Calculate eye position from inverse view matrix
    const invView = mat4.invert(viewMatrix);
    const eyeVec = vec3.transformMat4([0, 0, 0], invView);
    this.eye = new Vector(eyeVec[0], eyeVec[1], eyeVec[2]);

    // Calculate view-projection inverse for unprojection
    this.invViewProj = mat4.invert(mat4.multiply(projectionMatrix, viewMatrix));

    // Precalculate corner rays
    const [minX, minY, width, height] = viewport;
    const maxX = minX + width;
    const maxY = minY + height;

    this.ray00 = this.unProject(minX, minY, 1).subtract(this.eye);
    this.ray10 = this.unProject(maxX, minY, 1).subtract(this.eye);
    this.ray01 = this.unProject(minX, maxY, 1).subtract(this.eye);
    this.ray11 = this.unProject(maxX, maxY, 1).subtract(this.eye);
  }

  private unProject(winX: number, winY: number, winZ: number): Vector {
    const [vx, vy, vw, vh] = this.viewport;
    const x = ((winX - vx) / vw) * 2 - 1;
    const y = (1 - (winY - vy) / vh) * 2 - 1;

    const world = vec3.transformMat4([x, y, winZ], this.invViewProj);
    return new Vector(world[0], world[1], world[2]);
  }

  getRayForPixel(x: number, y: number): Vector {
    const [vx, vy, vw, vh] = this.viewport;
    const u = (x - vx) / vw;
    const v = (y - vy) / vh;

    const rayTop = Vector.lerp(this.ray00, this.ray10, u);
    const rayBottom = Vector.lerp(this.ray01, this.ray11, u);

    return Vector.lerp(rayTop, rayBottom, v).unit();
  }

  static hitTestSphere(origin: Vector, ray: Vector, center: Vector, radius: number): HitTest | null {
    const offset = origin.subtract(center);
    const a = ray.dot(ray);
    const b = 2 * ray.dot(offset);
    const c = offset.dot(offset) - radius * radius;
    const discriminant = b * b - 4 * a * c;

    if (discriminant > 0) {
      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      const hit = origin.add(ray.multiply(t));
      const normal = hit.subtract(center).divide(radius);
      return new HitTest(t, hit, normal);
    }

    return null;
  }
}
