import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Circle } from "react-leaflet";
import { divIcon, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLocation } from "wouter";
import { useWsEvents } from "@/contexts/WebSocketContext";
import type { WsEvent } from "@/contexts/WebSocketContext";

interface DevicePos {
  device_id: string;
  lat:       number;
  lng:       number;
  accuracy:  number | null;
  created_at: string;
}

const COLORS = ["#3f84f3", "#11d97a", "#ffc820", "#f03248", "#a855f7"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

function dotIcon(color: string, fresh: boolean) {
  return divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 0 8px ${color}${fresh ? ";animation:pulse 1.5s infinite" : ""}"></div>`,
    className: "",
    iconSize:  [12, 12],
    iconAnchor:[6, 6],
  });
}

export function MiniMap() {
  const { data, refetch } = useQuery<{ devices: DevicePos[] }>({
    queryKey: ["location-latest"],
    queryFn:  () => fetch(`${import.meta.env.BASE_URL}api/location/latest`).then(r => r.json()),
    refetchInterval: 15_000,
  });

  const locationEvents = useWsEvents((e: WsEvent) => e.type === "device.location.updated");
  useEffect(() => { if (locationEvents.length > 0) void refetch(); }, [locationEvents.length, refetch]);

  const [, navigate] = useLocation();

  const devices = data?.devices ?? [];
  if (devices.length === 0) return null;

  const center: LatLngTuple = [devices[0]!.lat, devices[0]!.lng];
  const isFresh = (iso: string) => Date.now() - new Date(iso).getTime() < 90_000;

  return (
    <button
      onClick={() => navigate("/map")}
      className="block w-full text-left"
      title="Open full map"
    >
      <div className="relative w-full h-32 rounded overflow-hidden border border-primary/20 hover:border-primary/40 transition-colors group">
        <MapContainer
          center={center}
          zoom={12}
          zoomControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          keyboard={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {devices.map(d => (
            <Marker
              key={d.device_id}
              position={[d.lat, d.lng] as LatLngTuple}
              icon={dotIcon(colorFor(d.device_id), isFresh(d.created_at))}
            />
          ))}
          {devices.map(d => d.accuracy != null && d.accuracy > 0 && (
            <Circle
              key={`acc-${d.device_id}`}
              center={[d.lat, d.lng] as LatLngTuple}
              radius={d.accuracy}
              pathOptions={{ color: colorFor(d.device_id), fillOpacity: 0.05, weight: 1 }}
            />
          ))}
        </MapContainer>

        {/* Overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-card/60 to-transparent" />
        <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between pointer-events-none">
          <div className="font-mono text-[9px] text-primary/60">
            {devices.length} TRACKER{devices.length !== 1 ? "S" : ""}
          </div>
          <div className="font-mono text-[9px] text-primary/30 group-hover:text-primary/60 transition-colors">
            OPEN MAP →
          </div>
        </div>
      </div>
    </button>
  );
}
