interface DealSidebarProps {
  children: React.ReactNode;
}

export default function DealSidebar({ children }: DealSidebarProps) {
  return (
    <div className="sticky top-16 flex flex-col gap-3 rounded-lg bg-surface/50 p-3">
      {children}
    </div>
  );
}
