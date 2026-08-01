"use client";

import maplibregl, {
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { GeoJSONPolygon } from "@/lib/api-types";
import { polygonBounds } from "@/lib/geo";
import { cn } from "@/lib/utils";

// The basemap style is bundled inline so every preview starts from the same
// in-memory definition. This eliminates the per-card race where some cards
// would fall back to a dark grid because the `/map-styles/basemap-street.json`
// fetch lost a race with MapLibre's load timeout.
const INLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    voyager: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 20,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f4efe9" } },
    { id: "voyager", type: "raster", source: "voyager" },
  ],
};

export function MiniMap({
  polygon,
  className,
}: {
  polygon: GeoJSONPolygon;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: INLINE_STYLE,
      center: [0, 0],
      zoom: 2,
      interactive: false,
      attributionControl: false,
    });
    mapRef.current = map;

    map.once("load", () => {
      map.resize();
      const sourceId = "aoi";
      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "Feature", geometry: polygon, properties: {} },
      });
      map.addLayer({
        id: "aoi-fill",
        type: "fill",
        source: sourceId,
        paint: { "fill-color": "#0ea5b7", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "aoi-line",
        type: "line",
        source: sourceId,
        paint: { "line-color": "#0ea5b7", "line-width": 2 },
      });
      const [minX, minY, maxX, maxY] = polygonBounds(polygon);
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 24, animate: false },
      );
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      if (mapRef.current === map) {
        map.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Polygon preview"
      // The basemap's own `background` layer paints this same colour, so even
      // before tiles arrive the card stays visually consistent with every
      // other card in the grid.
      style={{ backgroundColor: "#f4efe9" }}
      className={cn("h-40 w-full overflow-hidden rounded-md border border-border", className)}
    />
  );
}
