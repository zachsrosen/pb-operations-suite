import { render, screen } from '@testing-library/react';
import FileUploadPanel from '@/components/solar-designer/FileUploadPanel';

const mockDispatch = jest.fn();

describe('FileUploadPanel', () => {
  it('renders drop zone when no files uploaded', () => {
    render(
      <FileUploadPanel uploadedFiles={[]} panelCount={0} radiancePointCount={0}
        isUploading={false} uploadError={null} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/drop.*files/i)).toBeInTheDocument();
  });

  it('shows panel count when files are uploaded', () => {
    render(
      <FileUploadPanel uploadedFiles={[{ name: 'layout.json', type: 'json', size: 1024 }]}
        panelCount={24} radiancePointCount={0} isUploading={false} uploadError={null} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/24 panels/i)).toBeInTheDocument();
  });

  it('shows radiance point message for DXF with no panels', () => {
    render(
      <FileUploadPanel uploadedFiles={[{ name: 'site.dxf', type: 'dxf', size: 2048 }]}
        panelCount={0} radiancePointCount={42} isUploading={false} uploadError={null} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/42 radiance points/i)).toBeInTheDocument();
    expect(screen.getByText(/stage 3/i)).toBeInTheDocument();
  });

  it('shows loading state during upload', () => {
    render(
      <FileUploadPanel uploadedFiles={[]} panelCount={0} radiancePointCount={0}
        isUploading={true} uploadError={null} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/parsing/i)).toBeInTheDocument();
  });

  it('shows error message on upload failure', () => {
    render(
      <FileUploadPanel uploadedFiles={[]} panelCount={0} radiancePointCount={0}
        isUploading={false} uploadError="Invalid DXF format" dispatch={mockDispatch} />
    );
    expect(screen.getByText(/invalid dxf/i)).toBeInTheDocument();
  });
});
