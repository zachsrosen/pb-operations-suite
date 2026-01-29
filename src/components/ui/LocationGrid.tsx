"use client";

export interface LocationCount {
  location: string;
  count: number;
}

export interface LocationGridProps {
  locationCounts: Record<string, number>;
}

export function LocationGrid({ locationCounts }: LocationGridProps) {
  const sortedLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Projects by Location</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {sortedLocations.map(([location, count]) => (
          <LocationCard key={location} location={location} count={count} />
        ))}
      </div>
    </div>
  );
}

export function LocationCard({ location, count }: { location: string; count: number }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-4 text-center hover:bg-zinc-800 transition-colors cursor-pointer">
      <div className="text-2xl font-bold text-white stat-number">{count}</div>
      <div className="text-sm text-zinc-400">{location}</div>
    </div>
  );
}
