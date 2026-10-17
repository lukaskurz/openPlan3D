import { expect, it } from 'vitest';
import type { FurnitureItem } from '$lib/models/types';
import { findHandleAt } from '$lib/utils/hitTesting';
import { captionFlipped, furnitureCaptionLayout } from '$lib/utils/furnitureCaption';

const table = { id: 't', catalogId: 'table-coffee', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, width: 120, depth: 60 } as FurnitureItem;

it('gives a fingertip a bigger handle than the mouse', () => {
  // 15 px right of the bottom-right corner at zoom 1: outside the 8 px mouse box, inside a 22 px finger box.
  const nearCorner = { x: 60 + 15, y: 30 + 15 };
  expect(findHandleAt(nearCorner, 't', [table], 1)).toBeNull();
  expect(findHandleAt(nearCorner, 't', [table], 1, 22)).toBe('resize-br');
});

it('keeps the middle of a small item free for dragging under a finger', () => {
  const small = { ...table, width: 30, depth: 30 };
  expect(findHandleAt({ x: 0, y: 0 }, 't', [small], 1, 22)).toBeNull();
  expect(findHandleAt({ x: 15, y: 15 }, 't', [small], 1, 22)).toBe('resize-br');
});

it('picks the nearest handle where finger boxes overlap', () => {
  // The rotate handle sits 18 px above the top edge; 4 px above the edge is nearer the top resize handle.
  expect(findHandleAt({ x: 0, y: -30 - 4 }, 't', [table], 1, 22)).toBe('resize-t');
  expect(findHandleAt({ x: 0, y: -30 - 16 }, 't', [table], 1, 22)).toBe('rotate');
});

it('turns captions that would read upside down', () => {
  expect([0, 45, 90, 91, 180, 270, 271, -90, 450].map(captionFlipped)).toEqual([false, false, false, true, true, true, false, true, false]);
  expect(furnitureCaptionLayout({ ...table, rotation: 180 }, 1)?.flipped).toBe(true);
});
