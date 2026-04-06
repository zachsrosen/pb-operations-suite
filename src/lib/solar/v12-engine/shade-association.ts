/**
 * Solar Designer V12 Engine — Shade Point ↔ Panel Association
 *
 * Pure function: given panel geometry and radiance points, returns a map
 * of panel ID → associated shade point IDs using spatial lookup.
 *
 * Algorithm: AABB prefilter (coarse), then point-in-rotated-rect (precise).
 */
import type { PanelGeometry } from './types';
import type { RadiancePoint } from './layout-parser';

interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const EPSILON = 0.01; // meters — edge tolerance

/**
 * Build an axis-aligned bounding box for a potentially rotated panel.
 * Expands by EPSILON to catch points on edges.
 */
function panelAABB(p: PanelGeometry): AABB {
  const hw = p.width / 2;
  const hh = p.height / 2;
  const rad = (p.azimuth * Math.PI) / 180;
  const cosA = Math.abs(Math.cos(rad));
  const sinA = Math.abs(Math.sin(rad));
  // Rotated bounding box half-extents
  const extX = hw * cosA + hh * sinA;
  const extY = hw * sinA + hh * cosA;
  return {
    minX: p.x - extX - EPSILON,
    maxX: p.x + extX + EPSILON,
    minY: p.y - extY - EPSILON,
    maxY: p.y + extY + EPSILON,
  };
}

/**
 * Test if a point lies inside a rotated rectangle (panel).
 * Translate to panel-local coords, rotate by -azimuth, check ±half-dims.
 */
function pointInRotatedRect(
  px: number,
  py: number,
  panel: PanelGeometry
): boolean {
  const dx = px - panel.x;
  const dy = py - panel.y;
  const rad = (-panel.azimuth * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const localX = dx * cosA - dy * sinA;
  const localY = dx * sinA + dy * cosA;
  return (
    Math.abs(localX) <= panel.width / 2 + EPSILON &&
    Math.abs(localY) <= panel.height / 2 + EPSILON
  );
}

/**
 * Associates radiance points to panels via spatial lookup.
 *
 * @returns Record mapping each panel ID to its associated shade point IDs.
 *          Panels with no points get an empty array. Points outside all
 *          panels are silently dropped.
 */
export function associateShadePoints(
  panels: PanelGeometry[],
  radiancePoints: RadiancePoint[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const p of panels) {
    result[p.id] = [];
  }

  if (radiancePoints.length === 0) return result;

  // Precompute AABBs
  const aabbs = panels.map(panelAABB);

  for (const rp of radiancePoints) {
    // Coarse pass: which panels' AABBs contain this point?
    for (let i = 0; i < panels.length; i++) {
      const bb = aabbs[i];
      if (rp.x < bb.minX || rp.x > bb.maxX || rp.y < bb.minY || rp.y > bb.maxY) {
        continue;
      }
      // Precise pass: point-in-rotated-rect
      if (pointInRotatedRect(rp.x, rp.y, panels[i])) {
        result[panels[i].id].push(rp.id);
        break; // First match wins (lower-index tie-break)
      }
    }
  }

  return result;
}
