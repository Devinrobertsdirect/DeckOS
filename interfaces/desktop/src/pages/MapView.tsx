import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMapEvents, ZoomControl } from "react-leaflet";
import { divIcon, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MapPin, Plus, Trash2, RefreshCw, Radio, Crosshair, Activity,
  Wifi, Battery, Navigation, Circle as CircleIcon, X
} from "lucide-react";
import { HudCorners } from "@/components/HudCorners";
import { useWsEvents } from "@/contexts/WebSocketContext";
import type { WsEvent } from "@/contexts/WebSocketContext";

// ── Types ─────────────────────────────────────────────────────────────────

interface DevicePos {
  id:          string;
  device_id:   string;
  device_type: string;
  lat:         number;
  lng:         number;
  accuracy:    number | null;
  speed:       number | null;
  battery:     number | null;
  signal:      string | null;
  created_at:  string;
}

interface Geofence {
  id:            number;
  name:          string;
  lat:           number;
  lng:           number;
  radius_meters: number;
  color:         string;
  active:        boolean;
  tags:          string[];
  created_at:    string;
}

interface Trail { lat: number; lng: number; created_at: string; }

// ── Device colour palette ─────────────────────────────────────────────────

const DEVICE_COLORS = [
  "#3f84f3", "#11d97a", "#ffc820", "#f03248",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

function colorFor(deviceId: string): string {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  return DEVICE_COLORS[h % DEVICE_COLORS.length]!;
}

// ── Custom marker icon ────────────────────────────────────────────────────

function makeMarkerIcon(color: string, label: string, fresh: boolean) {
  const pulse = fresh ? `
    <div class="absolute inset-0 rounded-full animate-ping opacity-50" style="background:${color}"></div>` : "";
  return divIcon({
    html: `<div style="position:relative;width:32px;height:32px">
      ${pulse}
      <div style="width:32px;height:32px;border-radius:50%;background:${color};border:2.5px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#000;font-family:monospace;box-shadow:0 0 12px ${color}88;position:relative">
        ${label.substring(0, 3).toUpperCase()}
      </div>
    </div>`,
    className: "",
    iconSize:  [32, 32],
    iconAnchor:[16, 16],
  });
}

function makeGeofenceIcon(color: string) {
  return divIcon({
    html: `<div style="width:20px;height:20px;border-radius:50%;border:2px dashed ${color};background:${color}22;display:flex;align-items:center;justify-content:center">
      <div style="width:6px;height:6px;border-radius:50%;background:${color}"></div>
    </div>`,
    className: "",
    iconSize:  [20, 20],
    iconAnchor:[10, 10],
  });
}

// ── Map click handler ─────────────────────────────────────────────────────

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onClick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

// ── Main component ────────────────────────────────────────────────────────

export default function MapView() {
  const qc = useQueryClient();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [placingGeofence, setPlacingGeofence] = useState(false);
  const [pendingGeofence, setPendingGeofence] = useState<{ lat: number; lng: number } | null>(null);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneRadius, setNewZoneRadius] = useState(100);
  const [newZoneColor, setNewZoneColor] = useState("#3f84f3");
  const centerRef = useRef<[number, number]>([37.7749, -122.4194]);

  // Fetch latest positions
  const { data: latestData, refetch: refetchLatest } = useQuery({
    queryKey: ["location-latest"],
    queryFn:  () => fetch(`${import.meta.env.BASE_URL}api/location/latest`).then(r => r.json()),
    refetchInterval: 10_000,
  });

  // Fetch geofences
  const { data: geofenceData, refetch: refetchGeofences } = useQuery({
    queryKey: ["geofences"],
    queryFn:  () => fetch(`${import.meta.env.BASE_URL}api/geofences`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Fetch trail for selected device
  const { data: trailData } = useQuery({
    queryKey: ["trail", selectedDevice],
    queryFn:  () => fetch(`${import.meta.env.BASE_URL}api/location/${selectedDevice}/trail?limit=60`).then(r => r.json()),
    enabled:  !!selectedDevice,
  });

  // Mutations
  const createGeofence = useMutation({
    mutationFn: (body: object) => fetch(`${import.meta.env.BASE_URL}api/geofences`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["geofences"] }); setPendingGeofence(null); setNewZoneName(""); setPlacingGeofence(false); },
  });

  const deleteGeofence = useMutation({
    mutationFn: (id: number) => fetch(`${import.meta.env.BASE_URL}api/geofences/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["geofences"] }),
  });

  // Live updates via WebSocket
  const locationEvents = useWsEvents((e: WsEvent) => e.type === "device.location.updated");

  useEffect(() => {
    if (locationEvents.length > 0) {
      void refetchLatest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationEvents.length]);

  const devices: DevicePos[] = latestData?.devices ?? [];
  const geofences: Geofence[] = geofenceData?.geofences ?? [];
  const trail: Trail[]        = trailData?.trail ?? [];

  // Set initial map center to first device
  if (devices.length > 0 && devices[0]) {
    centerRef.current = [devices[0].lat, devices[0].lng];
  }

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (placingGeofence) setPendingGeofence({ lat, lng });
  }, [placingGeofence]);

  function handleCreateZone() {
    if (!pendingGeofence || !newZoneName.trim()) return;
    createGeofence.mutate({
      name: newZoneName.trim(),
      lat:  pendingGeofence.lat,
      lng:  pendingGeofence.lng,
      radiusMeters: newZoneRadius,
      color: newZoneColor,
    });
  }

  const isFresh = (iso: string) => Date.now() - new Date(iso).getTime() < 60_000;

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-primary/20 bg-card/50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative border-b border-primary/20 bg-primary/5 p-3">
          <HudCorners />
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Radio className="w-3.5 h-3.5" /> SPATIAL.RADAR
            </div>
            <button
              onClick={() => { void refetchLatest(); void refetchGeofences(); }}
              className="text-primary/40 hover:text-primary transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Tracker list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="font-mono text-[10px] text-primary/30 uppercase tracking-widest mb-3">
            ACTIVE TRACKERS ({devices.length})
          </div>

          {devices.length === 0 && (
            <div className="font-mono text-[10px] text-primary/20 text-center py-6">
              No trackers online.<br />
              Open DeckOS on your phone to begin.
            </div>
          )}

          {devices.map(d => {
            const color   = colorFor(d.device_id);
            const fresh   = isFresh(d.created_at);
            const isSelected = selectedDevice === d.device_id;
            return (
              <button
                key={d.device_id}
                onClick={() => setSelectedDevice(isSelected ? null : d.device_id)}
                className={`w-full text-left rounded border p-2.5 transition-all font-mono text-xs
                  ${isSelected
                    ? "bg-primary/10 border-primary/50"
                    : "bg-card/30 border-primary/10 hover:border-primary/30"
                  }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: fresh ? `0 0 6px ${color}` : "none" }} />
                  <span className="text-primary/80 truncate flex-1">{shortId(d.device_id)}</span>
                  {fresh && <span className="text-[10px] text-[#11d97a] animate-pulse">LIVE</span>}
                </div>
                <div className="text-primary/40 text-[10px] space-y-0.5 pl-4">
                  <div className="flex gap-1 items-center">
                    <MapPin className="w-2.5 h-2.5" />
                    {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
                  </div>
                  {d.accuracy != null && <div>±{d.accuracy.toFixed(0)}m acc.</div>}
                  {d.battery  != null && (
                    <div className="flex gap-1 items-center">
                      <Battery className="w-2.5 h-2.5" />
                      {(d.battery * 100).toFixed(0)}%
                    </div>
                  )}
                  {d.signal && (
                    <div className="flex gap-1 items-center">
                      <Wifi className="w-2.5 h-2.5" /> {d.signal}
                    </div>
                  )}
                  <div className="text-primary/25">{timeAgo(d.created_at)}</div>
                </div>
              </button>
            );
          })}

          {/* Geofences section */}
          <div className="font-mono text-[10px] text-primary/30 uppercase tracking-widest mt-5 mb-3">
            GEOFENCE ZONES ({geofences.length})
          </div>

          {geofences.map(z => (
            <div key={z.id} className="flex items-center gap-2 p-2 rounded border border-primary/10 bg-card/20 font-mono text-xs">
              <div className="w-2.5 h-2.5 rounded-full shrink-0 border" style={{ borderColor: z.color, background: `${z.color}33` }} />
              <div className="flex-1 min-w-0">
                <div className="text-primary/70 truncate">{z.name}</div>
                <div className="text-primary/30 text-[10px]">{z.radius_meters}m radius</div>
              </div>
              <button
                onClick={() => deleteGeofence.mutate(z.id)}
                className="text-primary/20 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Geofence toolbar */}
        <div className="border-t border-primary/10 p-3 space-y-2">
          {!placingGeofence && !pendingGeofence && (
            <button
              onClick={() => setPlacingGeofence(true)}
              className="w-full flex items-center gap-2 justify-center py-2 rounded border border-primary/20 bg-primary/5
                         hover:bg-primary/15 font-mono text-xs text-primary/60 hover:text-primary transition-all"
            >
              <Plus className="w-3 h-3" /> ADD GEOFENCE ZONE
            </button>
          )}

          {placingGeofence && !pendingGeofence && (
            <div className="font-mono text-xs text-primary/50 text-center space-y-2">
              <div className="flex items-center gap-2 text-primary/70">
                <Crosshair className="w-3.5 h-3.5 animate-pulse" />
                Click map to place zone
              </div>
              <button
                onClick={() => setPlacingGeofence(false)}
                className="text-primary/30 hover:text-primary/60 text-[10px] underline"
              >
                cancel
              </button>
            </div>
          )}

          {pendingGeofence && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Zone name…"
                value={newZoneName}
                onChange={e => setNewZoneName(e.target.value)}
                className="w-full bg-card/40 border border-primary/20 rounded px-2 py-1.5
                           font-mono text-xs text-primary/80 placeholder:text-primary/25 outline-none
                           focus:border-primary/50"
              />
              <div className="flex gap-2 items-center">
                <label className="font-mono text-[10px] text-primary/40 shrink-0">RAD(m)</label>
                <input
                  type="number"
                  min={10} max={50000}
                  value={newZoneRadius}
                  onChange={e => setNewZoneRadius(Number(e.target.value))}
                  className="flex-1 bg-card/40 border border-primary/20 rounded px-2 py-1
                             font-mono text-xs text-primary/80 outline-none focus:border-primary/50"
                />
                <input
                  type="color"
                  value={newZoneColor}
                  onChange={e => setNewZoneColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-primary/20 bg-transparent"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateZone}
                  disabled={!newZoneName.trim() || createGeofence.isPending}
                  className="flex-1 py-1.5 rounded bg-primary/20 border border-primary/30 font-mono text-xs
                             text-primary hover:bg-primary/30 disabled:opacity-40 transition-all"
                >
                  {createGeofence.isPending ? "SAVING…" : "CONFIRM"}
                </button>
                <button
                  onClick={() => { setPendingGeofence(null); setPlacingGeofence(false); }}
                  className="py-1.5 px-3 rounded border border-primary/10 font-mono text-xs text-primary/40
                             hover:text-primary/70 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="font-mono text-[10px] text-primary/25">
                📍 {pendingGeofence.lat.toFixed(5)}, {pendingGeofence.lng.toFixed(5)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Map area ──────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map header overlay */}
        <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none">
          <div className="flex items-center justify-between font-mono text-xs">
            <div className="bg-card/80 backdrop-blur border border-primary/30 rounded px-3 py-1.5 flex items-center gap-2">
              <Activity className="w-3 h-3 text-primary" />
              <span className="text-primary/70">SPATIAL.MAP</span>
              {devices.length > 0 && (
                <span className="text-[#11d97a]">{devices.length} ONLINE</span>
              )}
            </div>
            {placingGeofence && (
              <div className="bg-amber-500/20 border border-amber-500/40 rounded px-3 py-1.5 text-amber-300 flex items-center gap-2">
                <CircleIcon className="w-3 h-3 animate-pulse" /> CLICK TO PLACE ZONE
              </div>
            )}
          </div>
        </div>

        {/* Trail info overlay */}
        {selectedDevice && trail.length > 0 && (
          <div className="absolute bottom-3 left-3 z-[1000] bg-card/80 backdrop-blur border border-primary/30 rounded px-3 py-2 font-mono text-xs">
            <div className="text-primary/50 mb-1">TRAIL: {shortId(selectedDevice)}</div>
            <div className="text-primary/70">{trail.length} pts recorded</div>
            <div className="text-primary/30 text-[10px]">
              {trail[0] && `from ${timeAgo(trail[0].created_at)}`}
              {trail[trail.length - 1] && ` to ${timeAgo(trail[trail.length - 1]!.created_at)}`}
            </div>
            <button
              onClick={() => setSelectedDevice(null)}
              className="text-primary/30 hover:text-primary/60 text-[10px] underline mt-1"
            >
              clear trail
            </button>
          </div>
        )}

        <MapContainer
          center={centerRef.current}
          zoom={14}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
          className="deck-map"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <ZoomControl position="bottomright" />

          <MapClickHandler onClick={handleMapClick} />

          {/* Pending geofence marker */}
          {pendingGeofence && (
            <>
              <Circle
                center={[pendingGeofence.lat, pendingGeofence.lng]}
                radius={newZoneRadius}
                pathOptions={{ color: newZoneColor, fillColor: newZoneColor, fillOpacity: 0.12, dashArray: "6 4", weight: 2 }}
              />
              <Marker
                position={[pendingGeofence.lat, pendingGeofence.lng]}
                icon={makeGeofenceIcon(newZoneColor)}
              />
            </>
          )}

          {/* Geofence zones */}
          {geofences.map(z => (
            <Circle
              key={z.id}
              center={[z.lat, z.lng] as LatLngTuple}
              radius={z.radius_meters}
              pathOptions={{ color: z.color, fillColor: z.color, fillOpacity: 0.08, weight: 1.5, dashArray: "5 5" }}
            >
              <Popup className="deck-popup">
                <div className="font-mono text-xs bg-card text-primary p-2 rounded">
                  <div className="font-bold mb-1" style={{ color: z.color }}>{z.name}</div>
                  <div className="text-primary/50">r = {z.radius_meters}m</div>
                  <div className="text-primary/30 text-[10px]">{z.lat.toFixed(5)}, {z.lng.toFixed(5)}</div>
                </div>
              </Popup>
            </Circle>
          ))}

          {/* Trail polyline */}
          {selectedDevice && trail.length > 1 && (
            <Polyline
              positions={trail.map(p => [p.lat, p.lng] as LatLngTuple)}
              pathOptions={{
                color: colorFor(selectedDevice),
                weight: 2,
                opacity: 0.6,
                dashArray: "4 2",
              }}
            />
          )}

          {/* Device markers */}
          {devices.map(d => {
            const color   = colorFor(d.device_id);
            const fresh   = isFresh(d.created_at);
            const label   = shortId(d.device_id);
            return (
              <Marker
                key={d.device_id}
                position={[d.lat, d.lng] as LatLngTuple}
                icon={makeMarkerIcon(color, label, fresh)}
                eventHandlers={{ click: () => setSelectedDevice(d.device_id === selectedDevice ? null : d.device_id) }}
              >
                <Popup className="deck-popup">
                  <div className="font-mono text-xs bg-[#0a0e1a] border border-primary/30 text-primary p-3 rounded min-w-[160px]">
                    <div className="font-bold text-sm mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                      {shortId(d.device_id)}
                    </div>
                    <div className="space-y-1 text-[10px] text-primary/60">
                      <div className="flex gap-1"><MapPin className="w-2.5 h-2.5" /> {d.lat.toFixed(5)}, {d.lng.toFixed(5)}</div>
                      {d.accuracy != null && <div>Accuracy ±{d.accuracy.toFixed(0)}m</div>}
                      {d.speed    != null && d.speed > 0 && (
                        <div className="flex gap-1"><Navigation className="w-2.5 h-2.5" /> {(d.speed * 3.6).toFixed(1)} km/h</div>
                      )}
                      {d.battery != null && (
                        <div className="flex gap-1"><Battery className="w-2.5 h-2.5" /> {(d.battery * 100).toFixed(0)}%</div>
                      )}
                      {d.signal && <div className="flex gap-1"><Wifi className="w-2.5 h-2.5" /> {d.signal}</div>}
                      <div className="text-primary/30 pt-1">{timeAgo(d.created_at)}</div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
