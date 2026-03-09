"use client";

import { useState } from "react";

interface StepBasicsProps {
  initialName: string;
  initialAddress: string;
  onNext: (data: { name: string; address: string }) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function StepBasics({
  initialName,
  initialAddress,
  onNext,
  onCancel,
  saving,
}: StepBasicsProps) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);

  const canProceed = name.trim().length > 0 && name.trim().length <= 200;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Project Basics
        </h2>
        <p className="text-sm text-muted mt-1">
          Name your project and optionally add the site address.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="project-name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Project Name <span className="text-red-400">*</span>
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. Smith Residence 10kW"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-t-border text-foreground placeholder:text-muted/40 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 text-sm"
            autoFocus
          />
          <p className="text-[11px] text-muted/50 mt-1">
            {name.length}/200 characters
          </p>
        </div>

        <div>
          <label
            htmlFor="project-address"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Site Address{" "}
            <span className="text-muted/50 font-normal">(optional)</span>
          </label>
          <input
            id="project-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={500}
            placeholder="e.g. 123 Solar Ave, Phoenix, AZ 85001"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-t-border text-foreground placeholder:text-muted/40 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 text-sm"
          />
          <p className="text-[11px] text-muted/50 mt-1">
            Coordinates will be set later in the Map Design step.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-t-border">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onNext({ name: name.trim(), address: address.trim() })}
          disabled={!canProceed || saving}
          className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {saving ? "Creating..." : "Next: Equipment"}
        </button>
      </div>
    </div>
  );
}
