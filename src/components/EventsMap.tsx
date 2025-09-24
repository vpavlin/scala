import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { isValidLocation } from '@/lib/locationUtils';

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
  
  // Simple coordinate mapping for major cities (you can extend this)
  const locationMap: Record<string, [number, number]> = {
    'new york': [-74.006, 40.7128],
    'new york city': [-74.006, 40.7128],
    'nyc': [-74.006, 40.7128],
    'london': [-0.1276, 51.5074],
    'paris': [2.3522, 48.8566],
    'tokyo': [139.6503, 35.6762],
    'los angeles': [-118.2437, 34.0522],
    'la': [-118.2437, 34.0522],
    'san francisco': [-122.4194, 37.7749],
    'chicago': [-87.6298, 41.8781],
    'boston': [-71.0589, 42.3601],
    'seattle': [-122.3321, 47.6062],
    'miami': [-80.1918, 25.7617],
    'berlin': [13.4050, 52.5200],
    'madrid': [-3.7038, 40.4168],
    'rome': [12.4964, 41.9028],
    'amsterdam': [4.9041, 52.3676],
    'barcelona': [2.1734, 41.3851],
    'sydney': [151.2093, -33.8688],
    'toronto': [-79.3832, 43.6532],
    'vancouver': [-123.1207, 49.2827]
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
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [mapboxToken, setMapboxToken] = useState('');
  const [isTokenSet, setIsTokenSet] = useState(false);

  // Filter events that have valid locations
  const eventsWithLocations = events.filter(event => 
    event.location && isValidLocation(event.location)
  );

  const handleTokenSubmit = () => {
    if (mapboxToken.trim()) {
      setIsTokenSet(true);
    }
  };

  useEffect(() => {
    if (!mapContainer.current || !isTokenSet || !mapboxToken) return;

    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/light-v11',
        zoom: 2,
        center: [0, 20]
      });

      // Add navigation controls
      map.current.addControl(
        new mapboxgl.NavigationControl(),
        'top-right'
      );

      // Wait for map to load before adding markers
      map.current.on('load', () => {
        addEventMarkers();
      });

    } catch (error) {
      console.error('Error initializing map:', error);
    }

    // Cleanup
    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [isTokenSet, mapboxToken]);

  useEffect(() => {
    if (map.current && isTokenSet) {
      addEventMarkers();
    }
  }, [events, calendars, isTokenSet]);

  const addEventMarkers = () => {
    if (!map.current) return;

    // Clear existing markers
    markers.current.forEach(marker => marker.remove());
    markers.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    let validMarkersCount = 0;

    eventsWithLocations.forEach(event => {
      if (!event.location) return;

      const coordinates = getLocationCoordinates(event.location);
      if (!coordinates) return;

      const calendar = calendars.find(cal => cal.id === event.calendarId);
      
      // Create marker element
      const markerElement = document.createElement('div');
      markerElement.style.width = '12px';
      markerElement.style.height = '12px';
      markerElement.style.borderRadius = '50%';
      markerElement.style.backgroundColor = calendar?.color || '#3b82f6';
      markerElement.style.border = '2px solid white';
      markerElement.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
      markerElement.style.cursor = 'pointer';

      // Create marker
      const marker = new mapboxgl.Marker(markerElement)
        .setLngLat(coordinates)
        .addTo(map.current!);

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 15 })
        .setHTML(`
          <div class="p-2">
            <div class="font-medium text-sm">${event.title}</div>
            <div class="text-xs text-gray-600 mt-1">${event.location}</div>
            <div class="text-xs text-gray-500">
              ${event.date.toLocaleDateString()} ${event.time ? `at ${event.time}` : ''}
            </div>
            <button class="text-xs text-blue-600 hover:text-blue-800 mt-2 underline" 
                    onclick="window.dispatchEvent(new CustomEvent('event-click', {detail: '${event.id}'}))">
              View Details
            </button>
          </div>
        `);

      marker.setPopup(popup);
      markers.current.push(marker);

      bounds.extend(coordinates);
      validMarkersCount++;
    });

    // Fit map to markers if we have any
    if (validMarkersCount > 0) {
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 10
      });
    }
  };

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

  if (!isTokenSet) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Setup Map View</h3>
            <p className="text-sm text-muted-foreground mb-4">
              To enable the map view, please enter your Mapbox public token. 
              You can get one for free at{' '}
              <a 
                href="https://mapbox.com/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                mapbox.com
              </a>
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="mapbox-token">Mapbox Public Token</Label>
            <div className="flex space-x-2">
              <Input
                id="mapbox-token"
                type="password"
                placeholder="pk.eyJ1..."
                value={mapboxToken}
                onChange={(e) => setMapboxToken(e.target.value)}
              />
              <Button onClick={handleTokenSubmit} disabled={!mapboxToken.trim()}>
                Setup Map
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

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