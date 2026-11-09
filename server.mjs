import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.geojson':'application/geo+json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.md':'text/markdown; charset=utf-8' };
const places = { zadar:[44.1194,15.2314], rovinj:[45.0812,13.6387], karlovac:[45.4929,15.5553], osijek:[45.5549,18.6955] };
const roadKinds = new Set(['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street']);
const osmCache = new Map();
const cacheMillis = 30 * 60 * 1000;

function sendJson(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

function attribute(text, name) { return text.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]; }
function parseTags(body) { return Object.fromEntries([...body.matchAll(/<tag k="([^"]+)" v="([^"]+)"\/>/g)].map(([,key,value])=>[key,value])); }
function pointType(tags) {
  if (tags.amenity === 'parking' || tags.parking) return 'parking';
  if (['restaurant','cafe','fast_food','bar','pub','ice_cream'].includes(tags.amenity)) return 'competition';
  if (tags.highway === 'bus_stop' || tags.public_transport === 'platform' || tags.railway === 'tram_stop') return 'transit';
  if (['marketplace','cinema','theatre','arts_centre','library','community_centre','townhall','university','college'].includes(tags.amenity) || ['mall','supermarket','department_store'].includes(tags.shop) || ['museum','attraction'].includes(tags.tourism)) return 'attractor';
  return null;
}

function parseOsmMap(xml) {
  const nodes = new Map(), signals = [], roads = [], buildings = [];
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attributes = match[1], id = attribute(attributes,'id'), lat = Number(attribute(attributes,'lat')), lng = Number(attribute(attributes,'lon'));
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    nodes.set(id,[lat,lng]);
    const tags = parseTags(match[0]), type = pointType(tags);
    if (type) signals.push({type,lat,lng,name:tags.name || '',category:tags.amenity || tags.shop || tags.tourism || '',cuisine:tags.cuisine || '',openingHours:tags.opening_hours || ''});
  }
  for (const match of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const body=match[1], tags=parseTags(body), points=[...body.matchAll(/<nd ref="(\d+)"\/>/g)].map(([,id])=>nodes.get(id)).filter(Boolean);
    if (tags.building && points.length > 3 && points.length <= 24) buildings.push({points});
    if (roadKinds.has(tags.highway) && points.length > 1) roads.push({kind:tags.highway,points});
  }
  return {signals,roads,buildings};
}

async function liveOsmSnapshot(id) {
  const cached=osmCache.get(id);
  if (cached && Date.now()-cached.createdAt < cacheMillis) return {...cached.value,cached:true};
  const [lat,lng]=places[id] || [];
  if (!Number.isFinite(lat)) throw new Error('Nepoznato ogledno područje');
  const delta=.005;
  const bbox=[lng-delta,lat-delta,lng+delta,lat+delta].join(',');
  const response=await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`,{headers:{'User-Agent':'Kuna-local-market-compass-datathon'}});
  if (!response.ok) throw new Error(`OpenStreetMap API returned ${response.status}`);
  const value={...parseOsmMap(await response.text()),source:'OpenStreetMap API 0.6',retrievedAt:new Date().toISOString(),cached:false};
  osmCache.set(id,{createdAt:Date.now(),value});
  return value;
}

async function requestBody(req, limit=12_000) {
  let text='';
  for await (const chunk of req) { text+=chunk; if (text.length > limit) throw new Error('Zahtjev je prevelik'); }
  return JSON.parse(text || '{}');
}

function normalizeQuestion(value) { return String(value || '').replace(/\s+/g,' ').trim().slice(0,700); }
function assistantInstructions() {
  return 'Ti si KUNA, pomoćnik za rano procjenjivanje poslovne lokacije u Hrvatskoj. Piši prirodnim standardnim hrvatskim na latinici, bez miješanja drugih varijanti. Odgovaraj sažeto: najviše četiri kratke točke, svaka s konkretnim značenjem za odluku. Smiješ se osloniti samo na strukturirani kontekst koji dobiješ; ako podatak nedostaje, reci da nedostaje. Ne izmišljaj izvore, cijene, konkurente, zakonske uvjete ni financijske prognoze. Ne daješ pravni, porezni ni investicijski savjet. Jasno odvoji opažanja iz podataka od prijedloga za provjeru.';
}

async function answerWithOpenAi(question, context) {
  if (!process.env.OPENAI_API_KEY) { const error=new Error('OPENAI_API_KEY nije postavljen'); error.status=503; throw error; }
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      store:false,
      max_output_tokens:450,
      instructions:assistantInstructions(),
      input:`KONTEKST APLIKACIJE (strukturirani javni podaci):\n${JSON.stringify(context)}\n\nPITANJE KORISNIKA:\n${question}`
    })
  });
  const payload=await response.json();
  if (!response.ok) { const error=new Error(payload?.error?.message || `OpenAI API returned ${response.status}`); error.status=response.status; throw error; }
  const answer=payload.output_text || payload.output?.flatMap(item=>item.content || []).find(item=>item.type === 'output_text')?.text;
  if (!answer) throw new Error('Model nije vratio tekstualni odgovor');
  return {answer,model:payload.model || process.env.OPENAI_MODEL || 'gpt-5.4-mini',provider:'OpenAI'};
}

async function answerWithOllama(question, context) {
  const base=(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/,'');
  const model=process.env.OLLAMA_MODEL || 'qwen2.5:3b';
  let response;
  try {
    response=await fetch(`${base}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      model, stream:false,
      messages:[{role:'system',content:assistantInstructions()},{role:'user',content:`KONTEKST APLIKACIJE (strukturirani javni podaci):\n${JSON.stringify(context)}\n\nPITANJE KORISNIKA:\n${question}`}],
      options:{temperature:0.25,num_predict:450}
    })});
  } catch {
    const error=new Error('Lokalni Ollama nije pokrenut. Instalirajte Ollamu, preuzmite model i zatim ponovno pokrenite aplikaciju.'); error.status=503; throw error;
  }
  const payload=await response.json();
  if (!response.ok) { const error=new Error(payload?.error || `Ollama returned ${response.status}`); error.status=response.status; throw error; }
  const answer=payload?.message?.content?.trim();
  if (!answer) throw new Error('Lokalni model nije vratio tekstualni odgovor');
  return {answer,model,provider:'Ollama (lokalno)'};
}

async function answerWithLlm(question, context) {
  return process.env.AI_PROVIDER === 'openai' ? answerWithOpenAi(question,context) : answerWithOllama(question,context);
}

createServer(async (req, res) => {
  const url=new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname === '/api/open-data/osm') {
      if (req.method !== 'GET') return sendJson(res,405,{error:'Metoda nije dopuštena'});
      const id=url.searchParams.get('place') || '';
      if (!places[id]) return sendJson(res,400,{error:'Nepoznato područje'});
      return sendJson(res,200,await liveOsmSnapshot(id));
    }
    if (url.pathname === '/api/assistant') {
      if (req.method !== 'POST') return sendJson(res,405,{error:'Metoda nije dopuštena'});
      const body=await requestBody(req), question=normalizeQuestion(body.question);
      if (!question) return sendJson(res,400,{error:'Upišite pitanje.'});
      const context=body.context && typeof body.context === 'object' ? body.context : {};
      return sendJson(res,200,await answerWithLlm(question,context));
    }
    const wanted=url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file=normalize(join(root,wanted));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('Zabranjeno'); }
    const info=await stat(file);
    if (!info.isFile()) throw new Error('not file');
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch (error) {
    if (url.pathname.startsWith('/api/')) return sendJson(res,error.status || 502,{error:error.message || 'Vanjski izvor trenutačno nije dostupan'});
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('Nije pronađeno');
  }
}).listen(process.env.PORT || 4173,()=>console.log(`Kuna Kompas: http://localhost:${process.env.PORT || 4173}`));
