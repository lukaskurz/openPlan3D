<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import type { Point } from '$lib/models/types';
  import { canvasCamX, canvasCamY, canvasZoom } from '$lib/stores/project';
  import { canvasRect, planViewApi } from '$lib/stores/planView';
  import { sketching, sketchStrokes, addStroke, undoStroke, finishSketch } from '$lib/assistant/sketch';
  import Icon from './Icon.svelte';

  /** Drawing over the plan for the Assistant. Strokes are kept in plan cm, so they stay put while the plan moves. */
  let canvas: HTMLCanvasElement | undefined = $state();
  let current: Point[] | null = null;

  let rect = $derived($canvasRect);
  let shown = $derived(!!rect && ($sketching || $sketchStrokes.length > 0));

  const toPlan = (clientX: number, clientY: number): Point => {
    const r = get(canvasRect)!, zoom = get(canvasZoom);
    return { x: (clientX - r.left - (r.right - r.left) / 2) / zoom + get(canvasCamX), y: (clientY - r.top - (r.bottom - r.top) / 2) / zoom + get(canvasCamY) };
  };

  function draw() {
    if (!canvas || !rect) return;
    const w = rect.right - rect.left, h = rect.bottom - rect.top, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const zoom = $canvasZoom, camX = $canvasCamX, camY = $canvasCamY;
    const toScreen = (p: Point) => ({ x: (p.x - camX) * zoom + w / 2, y: (p.y - camY) * zoom + h / 2 });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(225, 29, 72, 0.9)';
    for (const stroke of current ? [...$sketchStrokes, current] : $sketchStrokes) {
      ctx.beginPath();
      stroke.map(toScreen).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    }
  }

  $effect(() => {
    void $sketchStrokes; void $canvasZoom; void $canvasCamX; void $canvasCamY; void rect; void canvas;
    draw();
  });

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas?.setPointerCapture(e.pointerId);
    current = [toPlan(e.clientX, e.clientY)];
    draw();
  }

  function onPointerMove(e: PointerEvent) {
    if (!current) return;
    const p = toPlan(e.clientX, e.clientY), last = current[current.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) * get(canvasZoom) < 2) return;
    current.push(p);
    draw();
  }

  function onPointerUp() {
    if (!current) return;
    const stroke = current;
    current = null;
    addStroke(stroke);
    draw();
  }

  // Scroll and pinch still move the plan while drawing.
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const api = get(planViewApi);
    if (e.ctrlKey || e.metaKey) api?.zoomBy(Math.exp(-e.deltaY * 0.01));
    else api?.panBy(-e.deltaX, -e.deltaY);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!$sketching) return;
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishSketch(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); undoStroke(); }
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#if shown && rect}
  <canvas
    bind:this={canvas}
    class="fixed z-[24] touch-none"
    style="left:{rect.left}px;top:{rect.top}px;width:{rect.right - rect.left}px;height:{rect.bottom - rect.top}px;pointer-events:{$sketching ? 'auto' : 'none'};cursor:crosshair"
    aria-label={$t('chrome.assistant.sketch.title')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    data-sketch-layer
  ></canvas>
  {#if $sketching}
    <div class="fixed z-[45] op-float op-cluster flex items-center gap-1 pl-4 pr-1.5 py-1.5 max-w-[calc(100vw-2rem)]" style="left:{(rect.left + rect.right) / 2}px;top:{rect.top + 136}px;transform:translateX(-50%)" role="toolbar" aria-label={$t('chrome.assistant.sketch.title')} data-sketch-bar>
      <span class="text-sm mr-2 truncate" style="color:var(--color-text)">{$t('chrome.assistant.sketch.hint')}</span>
      <button class="op-btn is-square" aria-label={$t('chrome.assistant.sketch.undo')} title={$t('chrome.assistant.sketch.undo')} disabled={!$sketchStrokes.length} onclick={undoStroke}><Icon name="undo" size={18} /></button>
      <button class="op-btn is-square" aria-label={$t('chrome.assistant.sketch.clear')} title={$t('chrome.assistant.sketch.clear')} disabled={!$sketchStrokes.length} onclick={() => sketchStrokes.set([])}><Icon name="trash" size={18} /></button>
      <button class="op-btn is-primary" onclick={finishSketch}>{$t('chrome.assistant.sketch.done')}</button>
    </div>
  {/if}
{/if}
