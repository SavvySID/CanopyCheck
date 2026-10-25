import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { STATUS_COLORS, effectiveStatus, imageExtent } from '../util.js';

const REFERENCE_COLOR = '#7cb8ff';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

function fitAll(map, projects) {
  if (!projects.length) return;
  if (projects.length === 1) {
    map.setView(projects[0].center, 5);
    return;
  }
  map.fitBounds(L.latLngBounds(projects.map((p) => p.center)), { padding: [40, 40], maxZoom: 6 });
}

export default function MapView({ projects, chain, selectedId, onSelect }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);
  const refGroupRef = useRef(null);
  const overlayRef = useRef(null);
  const [showLoss, setShowLoss] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showReference, setShowReference] = useState(true);

  useEffect(() => {
    const map = L.map(el.current, { worldCopyJump: true, minZoom: 2 }).setView([0, 0], 2);
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTRIBUTION }).addTo(map);
    refGroupRef.current = L.layerGroup().addTo(map);
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
      refGroupRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Project boundaries (coloured by credit status) with centre markers. The markers
  // stay visible when the boundary layer is off so projects remain selectable.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const p of projects) {
      const status = effectiveStatus(p, chain?.projects?.[p.id]);
      const color = STATUS_COLORS[status] ?? STATUS_COLORS.Unverified;
      const selected = p.id === selectedId;
      const layers = [L.circleMarker(p.center, { radius: selected ? 9 : 7, color: '#0b1410', weight: 2, fillColor: color, fillOpacity: 1 })];
      if (showBoundaries) {
        layers.unshift(L.rectangle(p.boundary, { color, weight: selected ? 3 : 2, fillColor: color, fillOpacity: selected ? 0.04 : 0.14 }));
      }
      for (const layer of layers) {
        layer.bindTooltip(`${p.name} · ${status}`, { direction: 'top' });
        layer.on('click', () => onSelect(p.id));
        layer.addTo(group);
      }
    }
  }, [projects, chain, selectedId, onSelect, showBoundaries]);

  // Reference areas used for the threat check.
  useEffect(() => {
    const group = refGroupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!showReference) return;
    for (const p of projects) {
      if (!p.reference) continue;
      L.rectangle(p.reference, { color: REFERENCE_COLOR, weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(group);
    }
  }, [projects, showReference]);

  // Fly to the selected project and drape its latest loss overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    overlayRef.current?.remove();
    overlayRef.current = null;
    const p = projects.find((x) => x.id === selectedId);
    if (!p) {
      fitAll(map, projects);
      return;
    }
    const latest = p.years?.[p.years.length - 1];
    if (showLoss && latest?.loss && p.imageBounds) {
      const overlay = L.imageOverlay(latest.loss, p.imageBounds, { opacity: 0.9, interactive: false });
      overlay.on('error', () => overlay.remove());
      overlayRef.current = overlay.addTo(map);
    }
    map.flyToBounds(imageExtent(p), { padding: [20, 20], maxZoom: 14, duration: 0.8 });
  }, [projects, selectedId, showLoss]);

  const selected = projects.find((p) => p.id === selectedId);
  const latestYear = selected?.years?.[selected.years.length - 1]?.year;
  const baseYear = selected?.years?.[0]?.year;

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="region" aria-label="Project map" />
      <div className="map-tools">
        <button type="button" className="btn btn-sm" onClick={() => mapRef.current && fitAll(mapRef.current, projects)}>
          All projects
        </button>
      </div>
      <div className="layers" role="group" aria-labelledby="map-layers-title">
        <div className="layers-title" id="map-layers-title">Map layers</div>
        <label className="layer">
          <input type="checkbox" checked={showBoundaries} onChange={(e) => setShowBoundaries(e.target.checked)} />
          <i className="lg lg-solid" aria-hidden="true" />
          <span className="layer-text">
            <span className="layer-name">Project boundary</span>
            <span className="layer-desc">
              Outline colour shows credit status:{' '}
              <span className="status-healthy">Healthy</span> · <span className="status-at-risk">At Risk</span> · <span className="status-frozen">Frozen</span>
            </span>
          </span>
        </label>
        <label className="layer">
          <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} />
          <i className="lg lg-dash" aria-hidden="true" />
          <span className="layer-text">
            <span className="layer-name">Reference area</span>
            <span className="layer-desc">Nearby forest used to test the claimed deforestation threat</span>
          </span>
        </label>
        <label className="layer">
          <input type="checkbox" checked={showLoss} onChange={(e) => setShowLoss(e.target.checked)} />
          <i className="lg lg-loss" aria-hidden="true" />
          <span className="layer-text">
            <span className="layer-name">Detected forest loss</span>
            <span className="layer-desc">
              {selected && baseYear && latestYear
                ? `Selected project: forest in ${baseYear}, cleared by ${latestYear} (non-forest in a later year). Model estimate, not field-confirmed.`
                : 'Forest at baseline, cleared in a later year. Model estimate, not field-confirmed.'}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
