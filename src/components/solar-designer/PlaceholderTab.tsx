interface PlaceholderTabProps {
  tabName: string;
  targetStage: number;
}

export default function PlaceholderTab({ tabName, targetStage }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
        <span className="text-2xl opacity-40">🔧</span>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{tabName}</h3>
      <p className="text-sm text-muted max-w-md">
        This tab will be available in Stage {targetStage}. Upload files and select equipment to get started.
      </p>
    </div>
  );
}
