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
  
  // Create a temporary anchor element to avoid popup blockers
  const link = document.createElement('a');
  link.href = mapUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  
  // Temporarily add to DOM and click
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}