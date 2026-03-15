"use client";

import { getStatusColor, STATUS_COLOR_HEX, type StatusColor } from "./deals-types";

interface StatusDotProps {
  value: string | null | undefined;
  /** True when pipeline doesn't support status fields */
  unavailable?: boolean;
}

export default function StatusDot({ value, unavailable }: StatusDotProps) {
  if (unavailable) {
    return <span style={{ color: "#555" }} title="Not available">○</span>;
  }

  const color: StatusColor = getStatusColor(value);
  const hex = STATUS_COLOR_HEX[color];

  if (color === "gray") {
    return <span style={{ color: hex }} title={value || "Not Started"}>○</span>;
  }

  return <span style={{ color: hex }} title={value || ""}>●</span>;
}
