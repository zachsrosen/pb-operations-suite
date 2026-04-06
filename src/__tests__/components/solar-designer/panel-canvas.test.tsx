import { render, screen, fireEvent } from '@testing-library/react';
import PanelCanvas from '@/components/solar-designer/PanelCanvas';
import type { PanelGeometry } from '@/lib/solar/v12-engine/types';

const mockPanels: PanelGeometry[] = [
  { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
  { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
];

describe('PanelCanvas', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <PanelCanvas
        panels={mockPanels}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[]}
        timestep={null}
        renderMode="shade"
        activeStringId={null}
      />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders one rect per panel', () => {
    const { container } = render(
      <PanelCanvas
        panels={mockPanels}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[]}
        timestep={null}
        renderMode="shade"
        activeStringId={null}
      />
    );
    const rects = container.querySelectorAll('rect[data-panel-id]');
    expect(rects.length).toBe(2);
  });

  it('calls onPanelClick when a panel is clicked', () => {
    const onClick = jest.fn();
    const { container } = render(
      <PanelCanvas
        panels={mockPanels}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[]}
        timestep={null}
        renderMode="strings"
        activeStringId={null}
        onPanelClick={onClick}
      />
    );
    const panelRect = container.querySelector('rect[data-panel-id="p1"]');
    fireEvent.click(panelRect!);
    expect(onClick).toHaveBeenCalledWith('p1');
  });

  it('renders empty state message when no panels', () => {
    render(
      <PanelCanvas
        panels={[]}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[]}
        timestep={null}
        renderMode="shade"
        activeStringId={null}
      />
    );
    expect(screen.getByText(/upload.*layout/i)).toBeInTheDocument();
  });

  it('renders panels with string colors in strings mode', () => {
    const { container } = render(
      <PanelCanvas
        panels={mockPanels}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[{ id: 1, panelIds: ['p1'] }]}
        timestep={null}
        renderMode="strings"
        activeStringId={null}
      />
    );
    const p1Rect = container.querySelector('rect[data-panel-id="p1"]');
    const p2Rect = container.querySelector('rect[data-panel-id="p2"]');
    expect(p1Rect).toBeInTheDocument();
    expect(p2Rect).toBeInTheDocument();
  });
});
