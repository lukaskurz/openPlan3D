/** True on touch-first devices (iPad, phones), whose hints should name taps rather than keys. */
export function prefersTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
