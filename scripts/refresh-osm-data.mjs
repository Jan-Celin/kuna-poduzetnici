import { mkdir, writeFile } from 'node:fs/promises';

const places = {
  zadar: [44.1194, 15.2314],
  rovinj: [45.0812, 13.6387],
  karlovac: [45.4929, 15.5553],
  osijek: [45.5549, 18.6955]
};
const roadKinds = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);
const outputDir = new URL('../assets/data/', import.meta.url);

function attribute(text, name) {
  return text.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function parseTags(body) {
  return Object.fromEntries([...body.matchAll(/<tag k="([^"]+)" v="([^"]+)"\/>/g)].map(([, key, value]) => [key, value]));
}

function pointType(tags) {
  if (tags.amenity === 'parking' || tags.parking) return 'parking';
  if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream'].includes(tags.amenity)) return 'competition';
  if (tags.highway === 'bus_stop' || tags.public_transport === 'platform' || tags.railway === 'tram_stop') return 'transit';
  if (['marketplace', 'cinema', 'theatre', 'arts_centre', 'library', 'community_centre', 'townhall', 'university', 'college'].includes(tags.amenity) || ['mall', 'supermarket', 'department_store'].includes(tags.shop) || ['museum', 'attraction'].includes(tags.tourism)) return 'attractor';
  return null;
}

function parseMap(xml) {
  const nodes = new Map();
  const signals = [];
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attributes = match[1];
    const id = attribute(attributes, 'id');
    const lat = Number(attribute(attributes, 'lat'));
    const lng = Number(attribute(attributes, 'lon'));
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    nodes.set(id, [lat, lng]);
    const tags = parseTags(match[0]);
    const type = pointType(tags);
    if (type) signals.push({
      type, lat, lng, name: tags.name || '',
      category: tags.amenity || tags.shop || tags.tourism || '',
      cuisine: tags.cuisine || '',
      openingHours: tags.opening_hours || ''
    });
  }

  const roads = [];
  const buildings = [];
  for (const match of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = match[1];
    const tags = parseTags(body);
    const kind = tags.highway;
    const points = [...body.matchAll(/<nd ref="(\d+)"\/>/g)].map(([, id]) => nodes.get(id)).filter(Boolean);
    if (tags.building && points.length > 3 && points.length <= 24) buildings.push({points});
    if (roadKinds.has(kind) && points.length > 1) roads.push({kind, points});
  }
  return {signals, roads, buildings};
}

async function getSnapshot([lat, lng]) {
  const delta = 0.005;
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(',');
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {headers:{'User-Agent':'Kuna-local-market-compass-demo'}});
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);
  return parseMap(await response.text());
}

async function getCitySnapshot([lat, lng]) {
  const snapshots = [];
  for (const northSouth of [-0.01, 0, 0.01]) {
    for (const eastWest of [-0.01, 0, 0.01]) snapshots.push(await getSnapshot([lat + northSouth, lng + eastWest]));
  }
  const signalKeys = new Set();
  const roadKeys = new Set();
  const buildingKeys = new Set();
  const signals = [];
  const roads = [];
  const buildings = [];
  snapshots.forEach(snapshot => {
    snapshot.signals.forEach(signal => {
      const key = `${signal.type}:${signal.lat}:${signal.lng}`;
      if (!signalKeys.has(key)) { signalKeys.add(key); signals.push(signal); }
    });
    snapshot.roads.forEach(road => {
      const key = `${road.kind}:${road.points.map(point => point.join(',')).join(';')}`;
      if (!roadKeys.has(key)) { roadKeys.add(key); roads.push(road); }
    });
    snapshot.buildings.forEach(building => {
      const key = building.points.map(point => point.join(',')).join(';');
      if (!buildingKeys.has(key)) { buildingKeys.add(key); buildings.push(building); }
    });
  });
  return {signals, roads, buildings};
}

const signalPlaces = {};
const roadPlaces = {};
const buildingPlaces = {};
for (const [id, centre] of Object.entries(places)) {
  process.stdout.write(`Preuzimam ${id}…\n`);
  const snapshot = await getCitySnapshot(centre);
  signalPlaces[id] = snapshot.signals;
  roadPlaces[id] = snapshot.roads;
  buildingPlaces[id] = snapshot.buildings;
}

const retrievedAt = new Date().toISOString();
await mkdir(outputDir, {recursive:true});
await Promise.all([
  writeFile(new URL('osm-signals.json', outputDir), JSON.stringify({source:'OpenStreetMap API 0.6 map snapshot', retrievedAt, places:signalPlaces}, null, 2) + '\n'),
  writeFile(new URL('osm-roads.json', outputDir), JSON.stringify({source:'OpenStreetMap API 0.6 map snapshot', retrievedAt, places:roadPlaces, buildings:buildingPlaces}, null, 2) + '\n')
]);
process.stdout.write('Spremljeni su assets/data/osm-signals.json i assets/data/osm-roads.json.\n');
