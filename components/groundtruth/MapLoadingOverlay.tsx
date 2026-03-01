"use client";

import { Loader2 } from "lucide-react";

interface MapLoadingOverlayProps {
  visible: boolean;
  label: string;
}

export default function MapLoadingOverlay({ visible, label }: MapLoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="gt-map-loader" role="status" aria-live="polite" aria-busy="true">
      <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
      <span>{label}</span>
    </div>
  );
}
