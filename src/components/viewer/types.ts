import type { ViewerSettings } from "@/lib/viewer-settings";

export interface ViewerPlotData {
  id: string;
  plotNumber: string;
  isMortgaged?:boolean;
  mortgageReference?:string|null;
  meshId: string | null;
  polygon: [number, number][] | null;
  status: string;
  areaSqYards: number;
  dimensions: string | null;
  facing: string | null;
  roadWidthFt: number | null;
  isCorner: boolean;
  pricePerSqYard: number;
  totalPrice: number;
  phase: string | null;
}

export interface ViewerFeature {
  id: string;
  kind: string;
  name: string | null;
  polygon: [number, number][];
}

export interface ViewerData {
  venture: {
    id: string;
    name: string;
    code: string;
    isDemo: boolean;
    status: string;
    viewerMode: "procedural" | "glb";
    modelUrl: string | null;
    layoutImage?: {url:string;width:number;height:number;unitsPerPixel:number}|null;
    amenities: string[];
    location: string | null;
    /** Per-venture presentation settings (parsed with defaults on the server). */
    settings?: Partial<ViewerSettings>;
    propertyType?: string;
    geofence?: { lat: number; lng: number; radiusM: number } | null;
  };
  plots: ViewerPlotData[];
  features: ViewerFeature[];
  canBook: boolean;
  /** Staff who may save the venture's opening view. */
  canEditPresentation?: boolean;
}

export interface SceneProps {
  data: ViewerData;
  selected: Set<string>;
  focused: string | null;
  visibleStatuses: Set<string>;
  showLabels: boolean;
  onPick: (plotId: string, additive: boolean) => void;
}

export const FEATURE_COLORS: Record<string, string> = {
  road: "#3a3f4b",
  park: "#2f7d4a",
  amenity: "#b08d2a",
  entrance: "#c9a227",
  boundary: "#1d2a52",
  water: "#2a6fb0",
  other: "#555b6b",
};

export function bounds(data: ViewerData) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const all = [...data.plots.flatMap((p) => p.polygon ?? []), ...data.features.flatMap((f) => f.polygon)];
  for (const [x, y] of all) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100, cx: 50, cy: 50, size: 100 };
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) };
}
