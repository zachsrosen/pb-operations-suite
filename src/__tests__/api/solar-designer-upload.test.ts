import { parseJSON, parseShadeCSV } from '@/lib/solar/v12-engine';
import { POST } from '@/app/api/solar-designer/upload/route';
import { NextRequest } from 'next/server';

// ── Parser smoke tests ──

describe('Solar Designer parser smoke tests', () => {
  it('parses JSON layout and returns panels', () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
        { data: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1.8 }, { x: 2, y: 1.8 }] },
      ],
    });
    const result = parseJSON(json);
    expect(result.panels.length).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid JSON', () => {
    const result = parseJSON('not valid json');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('parses shade CSV (column-oriented: first col = timestep, remaining = point IDs)', () => {
    const csv = 'timestep,pt_1,pt_2\n0,0,1\n1,1,1\n2,0,1\n';
    const result = parseShadeCSV(csv);
    expect(Object.keys(result.data)).toHaveLength(2);
    expect(result.data['pt_1']).toBeDefined();
    expect(result.data['pt_2']).toBeDefined();
    expect(result.data['pt_1'].substring(0, 3)).toBe('010');
  });
});

// ── Route-level tests ──
// Note: jsdom's File/Blob do not implement .text() — we mock req.formData() to supply
// plain objects with name + text() that the route handler reads.

function makeMockFile(name: string, content: string): File {
  return { name, size: content.length, text: () => Promise.resolve(content) } as unknown as File;
}

function makeRequest(files: { name: string; content: string }[]): NextRequest {
  const req = new NextRequest('http://localhost/api/solar-designer/upload', {
    method: 'POST',
    body: new FormData(),
  });
  const mockFiles = files.map(f => makeMockFile(f.name, f.content));
  jest.spyOn(req, 'formData').mockResolvedValue({
    getAll: () => mockFiles,
  } as unknown as FormData);
  return req;
}

describe('POST /api/solar-designer/upload', () => {
  it('returns 400 when no files provided', async () => {
    const req = new NextRequest('http://localhost/api/solar-designer/upload', {
      method: 'POST',
      body: new FormData(),
    });
    jest.spyOn(req, 'formData').mockResolvedValue({
      getAll: () => [],
    } as unknown as FormData);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no files/i);
  });

  it('parses JSON file and returns panels with fileCount', async () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
      ],
    });
    const req = makeRequest([{ name: 'layout.json', content: json }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(1);
    expect(body.fileCount).toBe(1);
    expect(body.radiancePointCount).toBe(0);
    expect(body.shadeFidelity).toBe('full');
    expect(body.shadeSource).toBe('manual');
  });

  it('parses CSV file and returns shade data (no panels)', async () => {
    const csv = 'timestep,pt_1,pt_2\n0,0,1\n1,1,0\n';
    const req = makeRequest([{ name: 'shade.csv', content: csv }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(0);
    expect(Object.keys(body.shadeData)).toHaveLength(2);
    expect(body.radiancePointCount).toBe(0);
  });

  it('returns errors for unsupported file types', async () => {
    const req = makeRequest([{ name: 'readme.txt', content: 'hello' }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toMatch(/unsupported file type/i);
  });

  it('handles mixed file upload (JSON + CSV)', async () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
      ],
    });
    const csv = 'timestep,pt_1\n0,1\n1,0\n';
    const req = makeRequest([
      { name: 'layout.json', content: json },
      { name: 'shade.csv', content: csv },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(1);
    expect(Object.keys(body.shadeData)).toHaveLength(1);
    expect(body.fileCount).toBe(2);
  });
});
