// Sun position from the NOAA low-precision solar ephemeris (about 0.1 degree accuracy, 1950-2050).
// Pure math, no Lens Studio APIs, so the same code can be checked outside the Lens.

export interface Place {
  name: string;
  lat: number; // degrees, north positive
  lon: number; // degrees, east positive
  utcOffset: (dayOfYear: number) => number; // hours
}

export const NEW_YORK: Place = {
  name: "New York",
  lat: 40.7128,
  lon: -74.006,
  // US daylight saving: second Sunday of March to first Sunday of November (2026: day 67 to day 305).
  utcOffset: (d) => (d >= 67 && d < 305 ? -4 : -5),
};

const RAD = Math.PI / 180;

export interface SunAngles {
  azimuth: number; // degrees clockwise from north
  elevation: number; // degrees above the horizon
}

// day: 1..365 of the given year, minutes: local clock minutes after midnight
export function sunAngles(place: Place, year: number, day: number, minutes: number): SunAngles {
  const utcMinutes = minutes - place.utcOffset(day) * 60;
  const ms = Date.UTC(year, 0, 1) + (day - 1) * 86400000 + utcMinutes * 60000;
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = mod(18.697374558 + 24.06570982441908 * n, 24);
  const lst = gmst * 15 + place.lon;
  const H = (lst - ra / RAD) * RAD;
  const lat = place.lat * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { azimuth: mod(az / RAD, 360), elevation: el / RAD };
}

// Unit vector pointing at the sun in room coordinates. The window's outward normal is +X,
// and windowAzimuth is the compass bearing that normal points to. Y is up.
export function sunVector(a: SunAngles, windowAzimuth: number): [number, number, number] {
  const el = a.elevation * RAD;
  const th = (a.azimuth - windowAzimuth) * RAD;
  return [Math.cos(el) * Math.cos(th), Math.sin(el), Math.cos(el) * Math.sin(th)];
}

export function sunriseSunset(place: Place, year: number, day: number): [number, number] {
  let rise = -1, set = -1, prev = sunAngles(place, year, day, 0).elevation;
  for (let m = 5; m <= 1440; m += 5) {
    const e = sunAngles(place, year, day, m).elevation;
    if (prev <= 0 && e > 0 && rise < 0) rise = m - 5 + (5 * -prev) / (e - prev);
    if (prev > 0 && e <= 0) set = m - 5 + (5 * prev) / (prev - e);
    prev = e;
  }
  return [rise, set];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function dayLabel(day: number): string {
  let m = 11;
  while (m > 0 && MONTH_START[m] >= day) m--;
  return MONTHS[m] + " " + (day - MONTH_START[m]);
}

export function dayOfYear(month: number, date: number): number {
  return MONTH_START[month - 1] + date;
}

export function clockLabel(minutes: number): string {
  const m = Math.round(minutes) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm < 10 ? "0" : ""}${mm} ${h < 12 ? "am" : "pm"}`;
}

function mod(a: number, b: number) {
  return ((a % b) + b) % b;
}
