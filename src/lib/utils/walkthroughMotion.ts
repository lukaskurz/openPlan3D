import { Euler, type Camera } from 'three';

const keys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight']);

export interface WalkthroughSettings {
  moveSpeed: number;
  sprintSpeed: number;
  eyeHeight: number;
  floorElevation: number;
  /** Where a short step ends once obstacles such as walls are accounted for. */
  collide?: (from: { x: number; z: number }, to: { x: number; z: number }) => { x: number; z: number };
}

/** Keyboard walking (WASD or arrows) relative to where the camera looks. Looking
 * itself is left to the mouse; this never changes the camera's orientation. */
export class WalkthroughMotion {
  private held = new Set<string>();
  private previous: number | null = null;
  private waitingForFirstFrame = false;
  private rightVelocity = 0;
  private forwardVelocity = 0;
  private rotation = new Euler(0, 0, 0, 'YXZ');

  get active() {
    const { right, forward } = this.direction();
    return Boolean(this.rightVelocity || this.forwardVelocity || right || forward);
  }

  private direction() {
    const held = (...codes: string[]) => Number(codes.some(code => this.held.has(code)));
    return {
      right: held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'),
      forward: held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'),
    };
  }

  /** Wake from the input event's clock, without counting the preceding idle time. */
  startClock(timestamp: number) {
    if (this.previous === null && Number.isFinite(timestamp)) {
      this.previous = timestamp;
      this.waitingForFirstFrame = true;
    }
  }

  stopClock() { this.previous = null; this.waitingForFirstFrame = false; }

  setKey(code: string, down: boolean, repeat = false) {
    if (!keys.has(code)) return false;
    // An OS repeat after returning to the page must not revive a key that blur
    // cleared. Accept movement again on a fresh press after release.
    if (down && repeat && !this.held.has(code)) return true;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  reset() {
    this.held.clear();
    this.stopClock();
    this.rightVelocity = this.forwardVelocity = 0;
  }

  advance(timestamp: number, camera: Camera, settings: WalkthroughSettings) {
    camera.position.y = settings.floorElevation + settings.eyeHeight;
    if (!Number.isFinite(timestamp)) { this.reset(); return; }
    if (this.previous === null) { this.previous = timestamp; return; }
    if (timestamp <= this.previous) {
      // RAF's shared frame timestamp can precede an input handler within that
      // frame. Keep its keys and wait for a frame after the wakeup time.
      if (timestamp < this.previous && !this.waitingForFirstFrame) this.reset();
      return;
    }
    this.waitingForFirstFrame = false;
    // A delayed frame must not teleport through the plan. Blur/visibility resets
    // separately discard all held input, momentum and elapsed background time.
    const delta = Math.min((timestamp - this.previous) / 1000, 0.25);
    this.previous = timestamp;
    const speed = this.held.has('ShiftLeft') || this.held.has('ShiftRight')
      ? settings.sprintSpeed : settings.moveSpeed;
    const { right, forward } = this.direction();
    const length = Math.hypot(right, forward) || 1;
    if (!right && !forward && !this.rightVelocity && !this.forwardVelocity) return;

    // Preserve the old slider's acceleration/drag balance (800 gives 80 cm/s
    // once settled). Integrate dv/dt = acceleration - 10v analytically, so
    // acceleration, coasting and sprint changes do not depend on frame cadence.
    const targetRight = right / length * speed / 10;
    const targetForward = forward / length * speed / 10;
    // Short substeps keep each collision step a couple of centimetres at most.
    // They update only the camera pose; the scene is still drawn once per RAF.
    const steps = Math.max(1, Math.ceil(delta * 120 - 1e-8));
    const step = delta / steps;
    const decay = Math.exp(-10 * step);
    const integral = -Math.expm1(-10 * step) / 10;
    const yaw = this.rotation.setFromQuaternion(camera.quaternion, 'YXZ').y;
    const move = (rightDistance: number, forwardDistance: number) => {
      const from = { x: camera.position.x, z: camera.position.z };
      const to = {
        x: from.x + Math.cos(yaw) * rightDistance - Math.sin(yaw) * forwardDistance,
        z: from.z - Math.sin(yaw) * rightDistance - Math.cos(yaw) * forwardDistance,
      };
      const end = settings.collide ? settings.collide(from, to) : to;
      camera.position.x = end.x;
      camera.position.z = end.z;
    };
    for (let i = 0; i < steps; i++) {
      const rightDistance = targetRight * step + (this.rightVelocity - targetRight) * integral;
      const forwardDistance = targetForward * step + (this.forwardVelocity - targetForward) * integral;
      this.rightVelocity = targetRight + (this.rightVelocity - targetRight) * decay;
      this.forwardVelocity = targetForward + (this.forwardVelocity - targetForward) * decay;
      move(rightDistance, forwardDistance);
    }
    // Finish the sub-pixel coasting tail rather than drawing forever as the
    // exponential approaches zero. Remaining travel is at most 0.001 cm.
    if (!right && !forward && Math.hypot(this.rightVelocity, this.forwardVelocity) < 0.01) {
      move(this.rightVelocity / 10, this.forwardVelocity / 10);
      this.rightVelocity = this.forwardVelocity = 0;
    }
  }
}
