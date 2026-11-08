import { describe, expect, it } from 'vitest';
import type { Floor, FurnitureItem, Project } from '$lib/models/types';
import { isProductUrl, productStatus, validateItemDetails, withNativeDetails, nativeItemDetails } from '$lib/utils/itemDetails';
import { referenceItemText } from '$lib/utils/aiRenderReferences';

const item = (extra: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'i1', catalogId: 'sofa_chaise', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra,
});
const project = (furniture: FurnitureItem[]): Project => ({
  id: 'p1', name: 'Test', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: 'Ground', walls: [], doors: [], windows: [], rooms: [], furniture } as unknown as Floor],
} as unknown as Project);

describe('furniture product link', () => {
  it('accepts only full http(s) addresses', () => {
    expect(isProductUrl('https://www.furnster.de/2611-ecksofa-mustang.html?number=IWA06')).toBe(true);
    expect(isProductUrl('http://example.com/chair')).toBe(true);
    for (const bad of ['', 'www.ikea.com/chair', 'javascript:alert(1)', 'ftp://example.com/x', 'https://' + 'a'.repeat(2050), 42, null])
      expect(isProductUrl(bad)).toBe(false);
  });

  it('validates productUrl on furniture details', () => {
    expect(() => validateItemDetails({ productUrl: 'https://example.com/sofa' }, 'furniture')).not.toThrow();
    expect(() => validateItemDetails({ productUrl: null }, 'furniture')).not.toThrow();
    expect(() => validateItemDetails({ productUrl: 'javascript:alert(1)' }, 'furniture')).toThrow();
    expect(() => validateItemDetails({ productUrl: 'not a url' }, 'furniture')).toThrow();
  });

  it('round-trips productUrl through the native package fields', () => {
    const native = withNativeDetails({ id: 'n1' }, { productUrl: 'https://example.com/sofa', photos: ['sofa.jpg'] }, 'furniture');
    expect(native.productUrl).toBe('https://example.com/sofa');
    expect(nativeItemDetails(native, 'furniture')).toMatchObject({ productUrl: 'https://example.com/sofa', photos: ['sofa.jpg'] });
    expect(withNativeDetails({ id: 'n1', productUrl: 'https://example.com/old' }, { productUrl: null }, 'furniture').productUrl).toBeUndefined();
  });

  it('reports whether an item is tied to a real product', () => {
    expect(productStatus({})).toEqual({ link: false, photo: false, complete: false });
    expect(productStatus({ productUrl: 'https://example.com/sofa' })).toEqual({ link: true, photo: false, complete: false });
    expect(productStatus({ photos: ['sofa.jpg'] })).toEqual({ link: false, photo: true, complete: false });
    expect(productStatus({ productUrl: 'https://example.com/sofa', photos: ['sofa.jpg'] }).complete).toBe(true);
  });

  it('names the product page in the AI render reference text', () => {
    const sofa = item({ details: { productUrl: 'https://example.com/sofa' } });
    expect(referenceItemText(sofa, project([sofa]))).toContain('product page https://example.com/sofa');
    const plain = item();
    expect(referenceItemText(plain, project([plain]))).not.toContain('product page');
  });
});
