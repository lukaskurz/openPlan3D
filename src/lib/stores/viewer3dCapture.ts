/**
 * A hand-off between the mounted 3D viewer and code that wants a picture of the
 * scene (the Assistant's view_3d tool). ThreeViewer registers a capturer while it
 * is mounted; nothing here imports three, so the main bundle stays light.
 */

/** A point in floor-local scene coordinates, cm: x = plan x, y up from the floor, z = plan y. */
export interface ScenePoint { x: number; y: number; z: number }

export interface Viewer3dShot {
  eye: ScenePoint;
  target: ScenePoint;
  /** Vertical field of view, degrees. */
  fov: number;
  width: number;
  height: number;
  /**
   * Overview pictures: walls, doors and windows on the sides of `box` (plan cm) that
   * face `towards` (a plan direction, the camera's side), or beyond them, are drawn
   * see-through so what stands behind them shows.
   */
  cutaway?: { box: { minX: number; minY: number; maxX: number; maxY: number }; towards: { x: number; y: number } };
}

export interface Viewer3dCapturer {
  /**
   * Brings the scene up to date with the project and waits until the furniture
   * models it is loading have arrived and the scene has stopped rebuilding, or
   * `deadline` (performance.now() time) passes. Resolves with how many models
   * were still loading.
   */
  whenReady(deadline: number): Promise<{ pendingModels: number }>;
  /** Renders the shot with an offscreen renderer and returns a JPEG data URL. Throws without WebGL. */
  capture(shot: Viewer3dShot): string;
}

let current: Viewer3dCapturer | null = null;
const waiters = new Set<(capturer: Viewer3dCapturer) => void>();

/** Called by ThreeViewer on mount; the returned function unregisters it. */
export function registerViewer3dCapture(capturer: Viewer3dCapturer): () => void {
  current = capturer;
  for (const wake of [...waiters]) wake(capturer);
  return () => { if (current === capturer) current = null; };
}

export function viewer3dCapturer(): Viewer3dCapturer | null {
  return current;
}

/** The registered capturer, waiting up to `timeoutMs` for one; null on timeout or abort. */
export function waitForViewer3dCapture(timeoutMs: number, signal?: AbortSignal): Promise<Viewer3dCapturer | null> {
  if (current) return Promise.resolve(current);
  return new Promise(resolve => {
    const finish = (capturer: Viewer3dCapturer | null) => {
      clearTimeout(timer);
      waiters.delete(finish);
      signal?.removeEventListener('abort', onAbort);
      resolve(capturer);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    waiters.add(finish);
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) finish(null);
  });
}
