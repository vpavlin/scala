import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card } from '@/components/ui/card';
import { isValidLocation } from '@/lib/locationUtils';

// Fix for default markers in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  endTime?: string;
  allDay?: boolean;
  calendarId: string;
  description?: string;
  location?: string;
  attendees?: string[];
  priority?: 'low' | 'medium' | 'high';
  status?: 'confirmed' | 'tentative' | 'cancelled';
  category?: string;
  url?: string;
  reminders?: number[];
  customFields?: Record<string, string>;
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
}

interface EventsMapProps {
  events: CalendarEvent[];
  calendars: CalendarData[];
  onEventClick: (event: CalendarEvent) => void;
}

// Simple geocoding function for common locations
const getLocationCoordinates = (location: string): [number, number] | null => {
  const normalizedLocation = location.toLowerCase().trim();
  
  // Simple coordinate mapping for major cities
  const locationMap: Record<string, [number, number]> = {
    'new york': [40.7128, -74.006],
    'new york city': [40.7128, -74.006],
    'nyc': [40.7128, -74.006],
    'manhattan': [40.7831, -73.9712],
    'brooklyn': [40.6782, -73.9442],
    'london': [51.5074, -0.1278],
    'paris': [48.8566, 2.3522],
    'tokyo': [35.6762, 139.6503],
    'los angeles': [34.0522, -118.2437],
    'la': [34.0522, -118.2437],
    'san francisco': [37.7749, -122.4194],
    'chicago': [41.8781, -87.6298],
    'boston': [42.3601, -71.0589],
    'seattle': [47.6062, -122.3321],
    'miami': [25.7617, -80.1918],
    'berlin': [52.5200, 13.4050],
    'madrid': [40.4168, -3.7038],
    'rome': [41.9028, 12.4964],
    'amsterdam': [52.3676, 4.9041],
    'barcelona': [41.3851, 2.1734],
    'sydney': [-33.8688, 151.2093],
    'toronto': [43.6532, -79.3832],
    'vancouver': [49.2827, -123.1207],
    'montreal': [45.5017, -73.5673],
    'dublin': [53.3498, -6.2603],
    'vienna': [48.2082, 16.3738],
    'zurich': [47.3769, 8.5417],
    'geneva': [46.2044, 6.1432],
    'stockholm': [59.3293, 18.0686],
    'copenhagen': [55.6761, 12.5683],
    'oslo': [59.9139, 10.7522],
    'helsinki': [60.1695, 24.9354],
    'warsaw': [52.2297, 21.0122],
    'prague': [50.0755, 14.4378],
    'budapest': [47.4979, 19.0402],
    'lisbon': [38.7223, -9.1393],
    'athens': [37.9838, 23.7275],
    'moscow': [55.7558, 37.6176],
    'beijing': [39.9042, 116.4074],
    'shanghai': [31.2304, 121.4737],
    'hong kong': [22.3193, 114.1694],
    'singapore': [1.3521, 103.8198],
    'mumbai': [19.0760, 72.8777],
    'delhi': [28.7041, 77.1025],
    'bangalore': [12.9716, 77.5946],
    'tel aviv': [32.0853, 34.7818],
    'jerusalem': [31.7683, 35.2137],
    'cairo': [30.0444, 31.2357],
    'cape town': [-33.9249, 18.4241],
    'johannesburg': [-26.2041, 28.0473],
    'mexico city': [19.4326, -99.1332],
    'buenos aires': [-34.6118, -58.3960],
    'rio de janeiro': [-22.9068, -43.1729],
    'sao paulo': [-23.5505, -46.6333],
    'lima': [-12.0464, -77.0428]
  };

  // Check for exact matches first
  if (locationMap[normalizedLocation]) {
    return locationMap[normalizedLocation];
  }

  // Check for partial matches
  for (const [key, coords] of Object.entries(locationMap)) {
    if (normalizedLocation.includes(key) || key.includes(normalizedLocation)) {
      return coords;
    }
  }

  return null;
};

export function EventsMap({ events, calendars, onEventClick }: EventsMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markersGroup = useRef<L.LayerGroup | null>(null);

  // Filter events that have valid locations
  const eventsWithLocations = events.filter(event => 
    event.location && isValidLocation(event.location)
  );

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize map
    map.current = L.map(mapContainer.current, {
      center: [20, 0], // Center of the world
      zoom: 2,
      zoomControl: true
    });

    // Add OpenStreetMap tiles (no API key required!)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map.current);

    // Create layer group for markers
    markersGroup.current = L.layerGroup().addTo(map.current);

    // Cleanup function
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!map.current || !markersGroup.current) return;

    // Clear existing markers
    markersGroup.current.clearLayers();

    const bounds: L.LatLngTuple[] = [];

    eventsWithLocations.forEach(event => {
      if (!event.location) return;

      const coordinates = getLocationCoordinates(event.location);
      if (!coordinates) return;

      const calendar = calendars.find(cal => cal.id === event.calendarId);
      
      // Create custom marker with calendar color
      const markerIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: ${calendar?.color || '#3b82f6'};
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      const marker = L.marker(coordinates, { icon: markerIcon });
      
      // Create popup content
      const popupContent = `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 200px;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${event.title}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">📍 ${event.location}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
            ${event.date.toLocaleDateString()} ${event.time ? `at ${event.time}` : ''}
          </div>
          <button 
            onclick="window.dispatchEvent(new CustomEvent('event-click', {detail: '${event.id}'}))"
            style="
              background: ${calendar?.color || '#3b82f6'};
              color: white;
              border: none;
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
            "
          >
            View Details
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      markersGroup.current!.addLayer(marker);
      bounds.push(coordinates);
    });

    // Fit map to markers if we have any
    if (bounds.length > 0) {
      map.current.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [events, calendars]);

  // Listen for custom event clicks from popups
  useEffect(() => {
    const handleEventClick = (e: CustomEvent) => {
      const eventId = e.detail;
      const event = events.find(evt => evt.id === eventId);
      if (event) {
        onEventClick(event);
      }
    };

    window.addEventListener('event-click' as any, handleEventClick);
    return () => {
      window.removeEventListener('event-click' as any, handleEventClick);
    };
  }, [events, onEventClick]);

  if (eventsWithLocations.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">No Locations Found</h3>
          <p className="text-sm text-muted-foreground">
            Add location information to your events to see them on the map.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="relative w-full h-96 rounded-lg overflow-hidden border border-border">
      <div ref={mapContainer} className="absolute inset-0" />
      <div className="absolute top-2 left-2 bg-card/90 backdrop-blur-sm rounded px-2 py-1 text-xs text-muted-foreground">
        {eventsWithLocations.length} event{eventsWithLocations.length !== 1 ? 's' : ''} with locations
      </div>
    </div>
  );
}