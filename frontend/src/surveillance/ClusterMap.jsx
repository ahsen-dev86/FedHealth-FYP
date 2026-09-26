// frontend/src/surveillance/ClusterMap.jsx
// Geospatial view of the anonymized, aggregated prediction clusters (scope
// 6.5.1). Two modes over the same data:
//   * markers — proportional circles per district (radius ∝ case_count, red if
//     any high-risk cases). Best for discrete district aggregates + click detail.
//   * heat    — a Leaflet.heat intensity layer for the classic heatmap look.
//
// The API returns aggregates only (district centroids rounded to 0.01°, counts,
// avg top score) — never patient points — so this map cannot expose an individual.
// Marker colour = condition; a thick red ring marks clusters with leukemia risk flags.
//
// NOTE: values from Postgres aggregates (count/avg) arrive as strings via
// node-pg, so we coerce with Number() before plotting.
import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { conditionLabel } from '../lib/format';
import { CLASS_HEX } from '../lib/contract';

const PK_CENTER = [30.3753, 69.3451]; // Pakistan

function pt(c) {
  return { lat: Number(c.approx_lat), lng: Number(c.approx_lng),
           cases: Number(c.case_count) || 0, highRisk: Number(c.high_risk_count) || 0,
           conf: Number(c.avg_confidence) || 0 };
}

// Imperatively manage a Leaflet.heat layer inside the react-leaflet map.
function HeatLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.heatLayer(points, { radius: 34, blur: 24, maxZoom: 8, minOpacity: 0.35 });
    layer.addTo(map);
    return () => layer.remove();
  }, [map, points]);
  return null;
}

export default function ClusterMap({ clusters, mode = 'markers' }) {
  const rows = (clusters || []).filter((c) => c.approx_lat != null && c.approx_lng != null);
  const heatPoints = rows.map((c) => {
    const p = pt(c);
    return [p.lat, p.lng, Math.min(1, p.cases / 10)]; // intensity capped at 10 cases
  });

  // Leaflet stacks its panes at z-index 400-1000; isolating the map in its own
  // stacking context keeps it below the filter dropdowns (z-50, portaled to body).
  return (
    <div className="relative isolate z-0" data-testid="cluster-map">
      <MapContainer center={PK_CENTER} zoom={5} scrollWheelZoom
                    style={{ height: 440, width: '100%', borderRadius: 10 }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {mode === 'heat'
          ? <HeatLayer points={heatPoints} />
          : rows.map((c, i) => {
              const p = pt(c);
              return (
                <CircleMarker key={i} center={[p.lat, p.lng]}
                  radius={Math.max(6, Math.min(30, 5 + p.cases * 2))}
                  pathOptions={{
                    color: p.highRisk > 0 ? CLASS_HEX.leukemia : (CLASS_HEX[c.condition] || '#0E7C7B'),
                    fillColor: CLASS_HEX[c.condition] || '#0E7C7B',
                    fillOpacity: 0.45, weight: p.highRisk > 0 ? 3 : 1.5,
                  }}>
                  <Popup>
                    <strong>{c.district || 'Unknown district'}</strong>
                    {c.province ? `, ${c.province}` : ''}<br />
                    {conditionLabel(c.condition)}<br />
                    <span style={{ fontFamily: 'monospace' }}>
                      {p.cases} screening result{p.cases === 1 ? '' : 's'} · {p.highRisk} risk flag{p.highRisk === 1 ? '' : 's'}<br />
                      avg top score {Math.round(p.conf * 100)}%
                    </span>
                  </Popup>
                </CircleMarker>
              );
            })}
      </MapContainer>
    </div>
  );
}
