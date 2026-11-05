// STUB – owned by the map agent. CONTRACT:
import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleId } from '@shared/types';

/** Offline-first basemap style (bundled world-atlas) with optional online raster/vector layers. Used by MapView, MiniMap, viewer & album headers. */
export function getMapStyle(_id: MapStyleId, _dark: boolean): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': _dark ? '#0b0d12' : '#e8ecf2' } }] };
}
