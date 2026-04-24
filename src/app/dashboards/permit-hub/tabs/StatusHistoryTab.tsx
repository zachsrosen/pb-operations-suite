export function StatusHistoryTab({
  history,
}: {
  history: Array<{ property: string; value: string | null; timestamp: string }>;
}) {
  if (!history.length) {
    return (
      <div className="text-muted text-sm">No status history recorded.</div>
    );
  }
  return (
    <ol className="relative border-l border-t-border pl-6">
      {history.map((entry, i) => (
        <li key={i} className="mb-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
          <div className="text-muted text-xs">
            {new Date(entry.timestamp).toLocaleString()}
          </div>
          <div className="text-sm">
            <span className="text-muted font-mono text-xs">{entry.property}:</span>{" "}
            <span className="font-medium">{entry.value ?? "—"}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
