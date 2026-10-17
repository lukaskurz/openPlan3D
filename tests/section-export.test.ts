import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSection } from '$lib/models/types';
import { exportSectionPDF, exportSectionSVG, sectionPdfLayout } from '$lib/utils/export';
import { computeSection } from '$lib/utils/sectionCut';
import { roomProject } from './fixtures/project';

const result = vi.hoisted(() => ({ filename: '', pdf: '' }));
vi.mock('jspdf', async importOriginal => {
  const actual = await importOriginal<typeof import('jspdf')>();
  return {
    default: class {
      constructor(options: ConstructorParameters<typeof actual.default>[0]) {
        const pdf = new actual.default(options);
        // The real encoder; only the download is intercepted.
        vi.spyOn(pdf, 'save').mockImplementation((filename = '') => {
          result.filename = filename;
          result.pdf = pdf.output();
          return pdf;
        });
        return pdf;
      }
    },
  };
});

let downloads: { blob: Blob; name: string }[];
beforeEach(() => {
  downloads = [];
  let last: Blob | null = null;
  vi.stubGlobal('document', { createElement: () => { const a = { download: '', href: '', click: () => downloads.push({ blob: last!, name: a.download }) }; return a; } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { last = blob as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

/** The 400 × 300 fixture room, cut west → east looking north. */
const section: PlanSection = { id: 's1', code: 'A', start: { x: -50, y: 150 }, end: { x: 450, y: 150 }, look: -1 };

describe('section exports', () => {
  it('downloads the section as an SVG file', async () => {
    expect(exportSectionSVG(roomProject(), section)).toBe(true);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('Regression plan - Section A.svg');
    const svg = await downloads[0].blob.text();
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    expect(svg).toContain('Section A–A');
    expect(svg.match(/<rect class="cut"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('localises the file name and title', async () => {
    exportSectionSVG(roomProject(), section, 'pt');
    expect(downloads[0].name).toBe('Regression plan - Corte A.svg');
    expect(await downloads[0].blob.text()).toContain('Corte A–A');
  });

  it('renders a vector PDF at 1:50 with the title block', () => {
    const scale = exportSectionPDF(roomProject(), section);
    expect(scale).toEqual({ scale: 50, denominator: 50 });
    expect(result.filename).toBe('Regression plan - Section A.pdf');
    expect(result.pdf).toMatch(/^%PDF-1\.[0-9]/);
    expect(result.pdf).toContain('/Count 1');
    expect(result.pdf).not.toContain('/Subtype /Image');
    expect(result.pdf).toContain('(Regression plan)');
    expect(result.pdf).toMatch(/\(Section A.A\)/);
    expect(result.pdf).toContain('(Scale: 1:50)');
    expect(result.pdf).toContain('%%EOF');
  });

  it('picks 1:100, then fits long sections to the page', () => {
    const project = roomProject();
    const labels = { title: 'Section A–A' };
    const area = { w: 273, h: 160 };
    const wide = computeSection(project, { ...section, end: { x: 1200, y: 150 } });
    expect(sectionPdfLayout(wide, labels, 'metric', area).scale).toBe(100);
    const huge = computeSection(project, { ...section, start: { x: -5000, y: 150 } });
    const fitted = sectionPdfLayout(huge, labels, 'metric', area);
    expect(fitted.scale).toBeNull();
    expect(fitted.denominator).toBeGreaterThan(100);
    expect(fitted.box.w * fitted.k).toBeLessThanOrEqual(area.w + 1e-6);
    exportSectionPDF(project, { ...section, start: { x: -5000, y: 150 } });
    expect(result.pdf).toMatch(/\(Scale: about 1:\d+ \\\(fitted to the page\\\)\)/);
  });
});
