// Walking: an axis-aligned box against the voxel world, with gravity, jumping,
// swimming and an optional fly mode.
import type { World } from './world.ts';

export class Player {
  p = [0.5, 40, 3.5];
  v = [0, 0, 0];
  yaw = 0;
  pitch = -0.08;
  onGround = false;
  fly = false;
  readonly w = 0.3;
  readonly h = 1.8;
  readonly eye = 1.62;
  private world: World;

  constructor(world: World) { this.world = world; }

  private collides(x: number, y: number, z: number): boolean {
    for (let bx = Math.floor(x - this.w); bx <= Math.floor(x + this.w); bx++)
      for (let by = Math.floor(y); by <= Math.floor(y + this.h - 0.01); by++)
        for (let bz = Math.floor(z - this.w); bz <= Math.floor(z + this.w); bz++)
          if (this.world.solidAt(bx, by, bz)) return true;
    return false;
  }

  /** move: [right, forward] in -1..1, up: jump/ascend, down: descend (fly). */
  step(dt: number, move: [number, number], up: boolean, down: boolean, sprint: boolean): void {
    const inWater = this.world.waterAt(Math.floor(this.p[0]!), Math.floor(this.p[1]! + 0.4), Math.floor(this.p[2]!));
    const speed = (this.fly ? 11 : sprint ? 6.2 : 4.3) * (inWater && !this.fly ? 0.55 : 1);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = move[0] * c - move[1] * s, wz = -move[0] * s - move[1] * c;
    const accel = this.onGround || this.fly || inWater ? 14 : 4;
    this.v[0]! += (wx * speed - this.v[0]!) * Math.min(1, accel * dt);
    this.v[2]! += (wz * speed - this.v[2]!) * Math.min(1, accel * dt);
    if (this.fly) {
      this.v[1] = (up ? speed : 0) - (down ? speed : 0);
    } else if (inWater) {
      this.v[1] = Math.max(this.v[1]! - 10 * dt, -3);
      if (up) this.v[1] = 3.2;
    } else {
      this.v[1] = Math.max(this.v[1]! - 28 * dt, -50);
      if (up && this.onGround) this.v[1] = 8.6;
    }
    this.onGround = false;
    for (let axis = 0; axis < 3; axis++) {
      const next = [...this.p];
      next[axis]! += this.v[axis]! * dt;
      if (this.collides(next[0]!, next[1]!, next[2]!)) {
        if (axis === 1 && this.v[1]! < 0) this.onGround = true;
        // step up one block when walking into a ledge
        if (axis !== 1 && this.onGroundish() && !this.collides(next[0]!, next[1]! + 1.01, next[2]!) && !this.fly) {
          this.p[axis] = next[axis]!;
          this.p[1]! += 1.01;
          continue;
        }
        this.v[axis] = 0;
      } else {
        this.p[axis] = next[axis]!;
      }
    }
    if (this.p[1]! < -20) this.p[1] = 100;
  }

  private onGroundish(): boolean {
    return this.collides(this.p[0]!, this.p[1]! - 0.05, this.p[2]!);
  }
}
