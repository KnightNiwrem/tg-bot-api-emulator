/** The widest horizontal accuracy radius, in meters, that TDLib's `Location` keeps. */
export const MAX_HORIZONTAL_ACCURACY_METERS = 1500;

/** A point on Earth that a user shares, as TDLib's `Location` holds it. */
export interface GeoLocation {
  /** From -90 to 90 degrees. */
  readonly latitude: number;
  /** From -180 to 180 degrees. */
  readonly longitude: number;
  /**
   * The radius of uncertainty, as the whole meters TDLib's `get_input_geo_point` sends Telegram;
   * omitted when unknown.
   */
  readonly horizontalAccuracyMeters?: number;
}

/**
 * Whether coordinates name a point on Earth, as TDLib's `Location::init` requires: both finite,
 * with a latitude from -90 to 90 degrees and a longitude from -180 to 180. TDLib treats any other
 * coordinates as no location.
 */
export function isPointOnEarth(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
}

/**
 * Creates a location from the coordinates and accuracy a client reports, rounding the accuracy up
 * to whole meters as TDLib's `get_input_geo_point` does. An accuracy of 0 means unknown.
 */
export function createGeoLocation(
  latitude: number,
  longitude: number,
  horizontalAccuracyMeters: number,
): GeoLocation {
  const roundedAccuracyMeters = Math.ceil(horizontalAccuracyMeters);
  return {
    latitude,
    longitude,
    ...(roundedAccuracyMeters > 0 ? { horizontalAccuracyMeters: roundedAccuracyMeters } : {}),
  };
}
