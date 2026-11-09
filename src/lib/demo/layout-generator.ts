/**
 * Generates a clearly-labelled DEMONSTRATION venture layout (not a real or
 * approved venture): blocks of plots separated by roads, plus a park and clubhouse.
 * Coordinates are metres on the layout plane (x → east, y → north).
 */

export interface GeneratedPlot {
  plotNumber: string;
  phaseCode: string;
  meshId: string;
  polygon: [number, number][];
  centroid: [number, number];
  widthFt: number;
  lengthFt: number;
  areaSqYards: number;
  facing: "N" | "S" | "E" | "W";
  roadWidthFt: number;
  isCorner: boolean;
}

export interface GeneratedFeature {
  kind: "road" | "park" | "amenity" | "boundary" | "entrance";
  name: string;
  polygon: [number, number][];
}

const FT = 0.3048;

export function generateDemoLayout(): { plots: GeneratedPlot[]; features: GeneratedFeature[]; size: { width: number; depth: number } } {
  const plotW = 30 * FT; // 30 ft frontage
  const plotD = 50 * FT; // 50 ft depth
  const road = 40 * FT; // 40 ft internal roads
  const mainRoad = 60 * FT; // 60 ft main road
  const perRow = 10;
  const blocks = [
    { code: "A", x0: 0, y0: 0 },
    { code: "B", x0: 0, y0: 2 * plotD + road },
    { code: "C", x0: perRow * plotW + mainRoad, y0: 0 },
    { code: "D", x0: perRow * plotW + mainRoad, y0: 2 * plotD + road },
  ];
  const plots: GeneratedPlot[] = [];
  let n = 1;
  for (const b of blocks) {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < perRow; i++) {
        const x = b.x0 + i * plotW;
        const y = b.y0 + row * plotD;
        const polygon: [number, number][] = [[x, y], [x + plotW, y], [x + plotW, y + plotD], [x, y + plotD]];
        const facing = row === 0 ? "S" : "N";
        const isCorner = i === 0 || i === perRow - 1;
        // Make some plots larger (corner plots get extra width)
        const widthFt = isCorner ? 33 : 30;
        const lengthFt = 50;
        plots.push({
          plotNumber: String(n),
          phaseCode: b.code,
          meshId: `PLOT_${String(n).padStart(3, "0")}`,
          polygon,
          centroid: [x + plotW / 2, y + plotD / 2],
          widthFt,
          lengthFt,
          areaSqYards: Math.round(((widthFt * lengthFt) / 9) * 100) / 100,
          facing: isCorner && i === perRow - 1 && b.x0 === 0 ? "E" : isCorner && i === 0 && b.x0 > 0 ? "W" : facing,
          roadWidthFt: (b.x0 === 0 && i === perRow - 1) || (b.x0 > 0 && i === 0) ? 60 : 40,
          isCorner,
        });
        n++;
      }
    }
  }
  const width = 2 * perRow * plotW + mainRoad;
  const blockDepth = 2 * plotD;
  const depth = 2 * blockDepth + road;
  const features: GeneratedFeature[] = [
    { kind: "road", name: "60 ft Main Road", polygon: [[perRow * plotW, -road], [perRow * plotW + mainRoad, -road], [perRow * plotW + mainRoad, depth + road], [perRow * plotW, depth + road]] },
    { kind: "road", name: "40 ft Internal Road", polygon: [[0, blockDepth], [width, blockDepth], [width, blockDepth + road], [0, blockDepth + road]] },
    { kind: "road", name: "40 ft Southern Road", polygon: [[0, -road], [width, -road], [width, 0], [0, 0]] },
    { kind: "road", name: "40 ft Northern Road", polygon: [[0, depth], [width, depth], [width, depth + road], [0, depth + road]] },
    { kind: "park", name: "Central Park", polygon: [[0, depth + road], [width * 0.45, depth + road], [width * 0.45, depth + road + 30], [0, depth + road + 30]] },
    { kind: "amenity", name: "Clubhouse", polygon: [[width * 0.55, depth + road + 4], [width * 0.8, depth + road + 4], [width * 0.8, depth + road + 26], [width * 0.55, depth + road + 26]] },
    { kind: "entrance", name: "Main Entrance", polygon: [[perRow * plotW, -road - 8], [perRow * plotW + mainRoad, -road - 8], [perRow * plotW + mainRoad, -road], [perRow * plotW, -road]] },
    { kind: "boundary", name: "Layout boundary", polygon: [[-4, -road - 4], [width + 4, -road - 4], [width + 4, depth + road + 34], [-4, depth + road + 34]] },
  ];
  return { plots, features, size: { width, depth: depth + 2 * road + 30 } };
}
