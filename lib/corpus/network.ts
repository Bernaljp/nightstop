/**
 * Airports and route block times.
 *
 * IATA codes and IANA zones are public reference data. The AIRLINES are invented —
 * no real operator's roster, format or network is modelled here.
 */
export interface Airport {
  iata: string;
  tz: string;
  city: string;
}

export const AIRPORTS: Record<string, Airport> = {
  MAD: { iata: "MAD", tz: "Europe/Madrid", city: "Madrid" },
  BCN: { iata: "BCN", tz: "Europe/Madrid", city: "Barcelona" },
  LIS: { iata: "LIS", tz: "Europe/Lisbon", city: "Lisbon" },
  CDG: { iata: "CDG", tz: "Europe/Paris", city: "Paris" },
  LHR: { iata: "LHR", tz: "Europe/London", city: "London" },
  FRA: { iata: "FRA", tz: "Europe/Berlin", city: "Frankfurt" },
  FCO: { iata: "FCO", tz: "Europe/Rome", city: "Rome" },
  DUB: { iata: "DUB", tz: "Europe/Dublin", city: "Dublin" },
  ARN: { iata: "ARN", tz: "Europe/Stockholm", city: "Stockholm" },
  JFK: { iata: "JFK", tz: "America/New_York", city: "New York" },
  BOS: { iata: "BOS", tz: "America/New_York", city: "Boston" },
  ORD: { iata: "ORD", tz: "America/Chicago", city: "Chicago" },
  LAX: { iata: "LAX", tz: "America/Los_Angeles", city: "Los Angeles" },
  GRU: { iata: "GRU", tz: "America/Sao_Paulo", city: "Sao Paulo" },
  BOG: { iata: "BOG", tz: "America/Bogota", city: "Bogota" },
  MEX: { iata: "MEX", tz: "America/Mexico_City", city: "Mexico City" },
  DXB: { iata: "DXB", tz: "Asia/Dubai", city: "Dubai" },
  SIN: { iata: "SIN", tz: "Asia/Singapore", city: "Singapore" },
  NRT: { iata: "NRT", tz: "Asia/Tokyo", city: "Tokyo" },
  JNB: { iata: "JNB", tz: "Africa/Johannesburg", city: "Johannesburg" },
};

export function tzOf(iata: string): string {
  const a = AIRPORTS[iata];
  if (!a) throw new Error(`unknown station ${iata}`);
  return a.tz;
}

/**
 * Scheduled block time in minutes. Declared one way round for readability and
 * normalised to a sorted key on load, so a lookup never depends on which order the
 * pair was written in.
 */
const BLOCK_DECLARED: Record<string, number> = {
  "MAD|BCN": 80, "MAD|LIS": 85, "MAD|CDG": 125, "MAD|LHR": 145, "MAD|FRA": 155,
  "MAD|FCO": 145, "MAD|DUB": 160, "MAD|ARN": 235, "MAD|JFK": 480, "MAD|BOS": 450,
  "MAD|ORD": 540, "MAD|LAX": 675, "MAD|GRU": 620, "MAD|BOG": 615, "MAD|MEX": 700,
  "MAD|DXB": 420, "MAD|SIN": 810, "MAD|NRT": 855, "MAD|JNB": 660,
  "LHR|CDG": 80, "LHR|DUB": 85, "LHR|FRA": 100, "LHR|FCO": 155, "LHR|ARN": 145,
  "LHR|JFK": 445, "LHR|BOS": 420, "LHR|ORD": 510, "LHR|LAX": 660, "LHR|SIN": 800,
  "LHR|NRT": 715, "LHR|DXB": 400, "LHR|JNB": 645, "LHR|GRU": 700, "LHR|BCN": 125,
  "BOG|MEX": 265, "BOG|JFK": 340, "BOG|GRU": 350, "BOG|LAX": 425, "BOG|MAD": 615,
  "BOG|ORD": 350, "BOG|BOS": 340,
};

const BLOCK: Record<string, number> = Object.fromEntries(
  Object.entries(BLOCK_DECLARED).map(([k, v]) => [k.split("|").sort().join("|"), v]),
);

function key(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function blockMinutes(a: string, b: string): number {
  const v = BLOCK[key(a, b)];
  if (v === undefined) throw new Error(`no block time for ${a}-${b}`);
  return v;
}

export function hasRoute(a: string, b: string): boolean {
  return BLOCK[key(a, b)] !== undefined;
}

/** Every station reachable from `a`. Used to validate an operator's network. */
export function destinationsFrom(a: string): string[] {
  return Object.keys(BLOCK)
    .map((k) => k.split("|"))
    .filter(([x, y]) => x === a || y === a)
    .map(([x, y]) => (x === a ? y : x))
    .sort();
}
