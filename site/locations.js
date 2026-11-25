const digitsAndLetters = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function streetKey(address) {
  return digitsAndLetters(String(address ?? '').toUpperCase()
    .replace(/\bU\.?S\.?[- ]+(?:HIGHWAY |HWY )?/g, 'USH ')
    .replace(/\bSTATE (?:ROAD|RD|HIGHWAY|HWY)\b/g, 'STH')
    .replace(/\bCOUNTY (?:ROAD|RD|HIGHWAY|HWY)\b/g, 'CTH')
    .replace(/\b(STREET|AVENUE|ROAD|DRIVE|BOULEVARD|LANE|COURT|PARKWAY|NORTH|SOUTH|EAST|WEST)\b/g,
      word => ({STREET:'ST', AVENUE:'AVE', ROAD:'RD', DRIVE:'DR', BOULEVARD:'BLVD', LANE:'LN',
        COURT:'CT', PARKWAY:'PKWY', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W'})[word]));
}

export const hasLocation = station => Number.isFinite(station.lat) && Number.isFinite(station.lng);
export const addressCityKey = (address,city) => `${streetKey(address)}|${digitsAndLetters(city)}`;
const brandKey = station => digitsAndLetters((station.brand || station.name || '')
  .replace(/\s*#\d+\b.*/, '').replace(/^costco\b.*/i,'Costco'));

export function createLocationLookup(locations) {
  const byAddress = new Map();
  for (const place of locations) {
    if (!place.address) continue;
    const key = `${place.countyFips}|${streetKey(place.address)}`;
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key).push(place);
  }
  return station => {
    if (!station.address) return null;
    const matches = byAddress.get(`${station.countyFips}|${streetKey(station.address)}`) ?? [];
    const city = digitsAndLetters(station.city);
    const inCity = matches.filter(place => city && city === digitsAndLetters(place.city));
    if (inCity.length === 1) return inCity[0];
    const sameBrand = matches.filter(place => !place.city && brandKey(place) === brandKey(station));
    return sameBrand.length === 1 ? sameBrand[0] : null;
  };
}

export function unpricedLocations(locations, quotes, matchAddress) {
  const matched = new Set(quotes.filter(hasLocation).map(quote => matchAddress(quote)?.id));
  const grid = new Map();
  const gridCell = value => Math.floor(value * 500);
  for (const quote of quotes.filter(hasLocation)) {
    const key = `${gridCell(quote.lat)},${gridCell(quote.lng)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(quote);
  }
  return locations.filter(place => {
    if (matched.has(place.id)) return false;
    const y = gridCell(place.lat), x = gridCell(place.lng);
    for (let row = y - 1; row <= y + 1; row++) {
      for (let column = x - 1; column <= x + 1; column++) {
        const near = grid.get(`${row},${column}`) ?? [];
        if (near.some(quote => Math.abs(quote.lat - place.lat) < .00055 &&
          Math.abs(quote.lng - place.lng) < .00075 && brandKey(quote) === brandKey(place))) return false;
      }
    }
    return true;
  });
}
