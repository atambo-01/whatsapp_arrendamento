import { locationCoords } from "../data/coords.js";
import { knownLocations } from "../data/locations.js";

const lowerIndex = new Map(Object.entries(locationCoords).map(([k, v]) => [k.toLowerCase(), v]));

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Resolve [lat, lng] from a matched neighborhood, falling back to the raw text. */
export function resolveCoords(location, locationRaw) {
  if (location && lowerIndex.has(location.toLowerCase())) return lowerIndex.get(location.toLowerCase());
  const raw = (locationRaw || "").toLowerCase();
  if (!raw) return null;
  // Longest names first so "Kilamba Kiaxi" wins over "Kilamba".
  const names = [...knownLocations].sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (raw.includes(n.toLowerCase()) && lowerIndex.has(n.toLowerCase())) return lowerIndex.get(n.toLowerCase());
  }
  return null;
}
