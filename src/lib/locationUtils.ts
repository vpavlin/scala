/**
 * Determines if a location string looks like it could be a valid address or place
 */
export function isValidLocation(location: string): boolean {
  if (!location || location.trim().length < 3) {
    return false;
  }
  
  // Check if it's not just a URL or email
  if (location.includes('http') || location.includes('@')) {
    return false;
  }
  
  return true;
}

/**
 * Creates an OpenStreetMap search URL for a given location
 */
export function createMapUrl(location: string): string {
  const encodedLocation = encodeURIComponent(location.trim());
  return `https://www.openstreetmap.org/search?query=${encodedLocation}`;
}

/**
 * Opens a location in a map service in a new tab
 */
export function openLocationInMap(location: string): void {
  if (!isValidLocation(location)) {
    return;
  }
  
  const mapUrl = createMapUrl(location);
  window.open(mapUrl, '_blank', 'noopener,noreferrer');
}