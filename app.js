const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const places = {
  zadar: {name:'Zadar',lat:44.1194,lng:15.2314,pop:'70.829',tour:'4,2×',traffic:'Umjeren',work:'+3,1 %',access:'dobar za gradski scenarij'},
  rovinj: {name:'Rovinj',lat:45.0812,lng:13.6387,pop:'12.968',tour:'9,1×',traffic:'Visok',work:'+3,1 %',access:'izražen sezonski pritisak'},
  karlovac: {name:'Karlovac',lat:45.4929,lng:15.5553,pop:'49.377',tour:'2,6×',traffic:'Srednji',work:'+2,4 %',access:'stabilniji tijekom godine'},
  osijek: {name:'Osijek',lat:45.5549,lng:18.6955,pop:'96.313',tour:'2,1×',traffic:'Srednji',work:'+2,8 %',access:'šira lokalna baza'}
};

let place = 'zadar';
let candidates = ['zadar'];
let detailMode = 'overview';
let plan = [];
let map;
let markers = {};
let mapOverlays = [];
let mapSignals = {places:{}};
let mapRoads = {places:{}};
let roadOverlays = [];
let buildingOverlays = [];
const roadReachCache = new Map();
let nationalTiles;
let signalFocus = null;
let businessIdea = '';
let liveOsm = {place:null,retrievedAt:null,cached:false};
const liveOsmRequests = new Set();
const visibleLayers = new Set(['reach','roadReach','competition','parking','transit']);

function isNationalView() { return !map || map.getZoom() < 10; }

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function restoreIdeaState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('kuna-idea') || 'null');
    if (!saved) return;
    businessIdea = saved.description || '';
    if (saved.profile && [...$('#profile').options].some(option => option.value === saved.profile)) $('#profile').value = saved.profile;
    if (saved.audience && [...$('#audience').options].some(option => option.value === saved.audience)) $('#audience').value = saved.audience;
  } catch {}
}

function rememberIdeaState() {
  sessionStorage.setItem('kuna-idea', JSON.stringify({profile:$('#profile').value,audience:$('#audience').value,description:businessIdea}));
}

function currentReach() { return $('#drive').textContent.replace('⌄','').trim(); }
function currentRadius() { return Number(currentReach().split(' ')[0]) * .7; }
function signalItems(type) { return (mapSignals.places?.[place] || []).filter(item => item.type === type); }

function mergeLiveSignals(existing, incoming) {
  const seen = new Set(existing.map(item => `${item.type}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`));
  return [...existing,...incoming.filter(item => {
    const key=`${item.type}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  })];
}

async function refreshLiveOsm(id=place) {
  if (!places[id] || liveOsmRequests.has(id)) return;
  liveOsmRequests.add(id);
  try {
    const response=await fetch(`/api/open-data/osm?place=${encodeURIComponent(id)}`,{cache:'no-store'});
    if (!response.ok) throw new Error('live source unavailable');
    const snapshot=await response.json(), existing=mapSignals.places?.[id] || [];
    mapSignals={...mapSignals,places:{...mapSignals.places,[id]:mergeLiveSignals(existing,snapshot.signals || [])}};
    liveOsm={place:id,retrievedAt:snapshot.retrievedAt || null,cached:Boolean(snapshot.cached)};
    if (place === id) render();
  } catch {
    if (place === id) toast('Uživo OSM izvor nije dostupan; prikazan je lokalni snimak.');
  } finally { liveOsmRequests.delete(id); }
}

function distanceMetres(a, b) {
  const lat = Math.PI / 180, radius = 6371000;
  const dLat = (b.lat - a.lat) * lat, dLng = (b.lng - a.lng) * lat;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * lat) * Math.cos(b.lat * lat) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function roadKey(point) { return `${point[0].toFixed(5)}:${point[1].toFixed(5)}`; }
function roadSpeed(kind) {
  return ({motorway:80,trunk:65,primary:48,secondary:38,tertiary:30,unclassified:25,residential:20,living_street:14})[kind] || 20;
}
function roadTravelSeconds(a, b, kind) { return distanceMetres({lat:a[0],lng:a[1]},{lat:b[0],lng:b[1]}) / (roadSpeed(kind) * 1000 / 3600); }

function roadReachability(id, minutes) {
  const cacheKey = `${id}:${minutes}`;
  if (roadReachCache.has(cacheKey)) return roadReachCache.get(cacheKey);
  const roads = mapRoads.places?.[id] || [];
  const nodes = new Map(), segments = [];
  const ensureNode = point => {
    const key = roadKey(point);
    if (!nodes.has(key)) nodes.set(key,{key,lat:point[0],lng:point[1],links:[]});
    return nodes.get(key);
  };
  roads.forEach(road => {
    for (let i=1;i<road.points.length;i++) {
      const a=ensureNode(road.points[i-1]), b=ensureNode(road.points[i]);
      const seconds=roadTravelSeconds(road.points[i-1],road.points[i],road.kind);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const segment={a,b,kind:road.kind,points:[road.points[i-1],road.points[i]],seconds,road};
      a.links.push({to:b,segment}); b.links.push({to:a,segment}); segments.push(segment);
    }
  });
  const origin = places[id];
  let start=null, nearest=Infinity;
  nodes.forEach(node => { const d=distanceMetres(origin,node); if (d<nearest) { nearest=d;start=node; } });
  const budget=minutes*60, distances=new Map(), queue=[];
  const push = item => { queue.push(item); let i=queue.length-1; while(i){const p=(i-1)>>1;if(queue[p].seconds<=item.seconds)break;queue[i]=queue[p];i=p;}queue[i]=item; };
  const pop = () => { const head=queue[0], last=queue.pop(); if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1].seconds<queue[child].seconds)child++;if(queue[child].seconds>=last.seconds)break;queue[i]=queue[child];i=child;}queue[i]=last;} return head; };
  if (start) { distances.set(start.key,0); push({node:start,seconds:0}); }
  while(queue.length) {
    const current=pop();
    if (current.seconds !== distances.get(current.node.key) || current.seconds>budget) continue;
    current.node.links.forEach(({to,segment}) => { const next=current.seconds+segment.seconds; if(next<=budget && next<(distances.get(to.key) ?? Infinity)){distances.set(to.key,next);push({node:to,seconds:next});} });
  }
  const reachable=[...distances.entries()].filter(([,seconds])=>seconds<=budget).map(([key,seconds])=>({...nodes.get(key),seconds}));
  const reachableSegments=segments.filter(segment => Math.min(distances.get(segment.a.key) ?? Infinity,distances.get(segment.b.key) ?? Infinity)<=budget);
  const result={origin,reachable,reachableSegments,budget};
  roadReachCache.set(cacheKey,result); return result;
}

function reachEnvelope(origin, nodes) {
  const bins=28, sectors=Array.from({length:bins},()=>null);
  nodes.forEach(node => {
    const north=(node.lat-origin.lat)*111100, east=(node.lng-origin.lng)*111100*Math.cos(origin.lat*Math.PI/180);
    const length=Math.hypot(north,east); if (length<120) return;
    const angle=(Math.atan2(east,north)+Math.PI*2)%(Math.PI*2), index=Math.floor(angle/(Math.PI*2)*bins);
    if(!sectors[index] || length>sectors[index].length) sectors[index]={...node,length};
  });
  return sectors.map((point,index) => {
    if(point) return [point.lat,point.lng];
    for(let step=1;step<bins;step++) { const left=sectors[(index-step+bins)%bins],right=sectors[(index+step)%bins]; if(left&&right)return [(left.lat+right.lat)/2,(left.lng+right.lng)/2]; }
    return [origin.lat,origin.lng];
  });
}

function nearbyCount(type, focus, radius = 420) {
  if (!focus?.lat) return signalItems(type).length;
  return signalItems(type).filter(item => distanceMetres(focus, item) <= radius).length;
}

function counted(value, singular, plural) { return `${value} ${value === 1 ? singular : plural}`; }

function conceptName() {
  const profile = $('#profile').value;
  const audience = $('#audience').value;
  const text = businessIdea.toLowerCase();
  const noun = profile === 'Ugostiteljstvo i prehrana'
    ? (/(kava|kafi|coffee)/.test(text) ? 'kafić' : /(restoran|ručak|večer)/.test(text) ? 'restoran' : 'ugostiteljski koncept')
    : profile === 'Trgovina' ? 'lokalna trgovina'
      : profile === 'Turizam i doživljaji' ? 'lokalni doživljaj'
        : profile === 'Osobne i zdravstvene usluge' ? 'uslužni koncept'
          : profile === 'Stručne i digitalne usluge' ? 'stručna usluga'
            : profile === 'Obrt i proizvodnja' ? 'obrtnički koncept'
              : 'vaš koncept';
  const prefix = /(jutro|doru|brunch)/.test(text) ? 'jutarnji'
    : /(obitelj|djeca|family)/.test(text) ? 'obiteljski'
      : /(brzo|takeaway|preuzim)/.test(text) ? 'brzi'
        : /(mirn|rad|cowork)/.test(text) ? 'mirni'
          : /(lokaln|susjed)/.test(text) ? 'lokalni'
            : '';
  const audienceLabel = audience === 'Stanovnici i radnici' ? 'za stanovnike i radnike'
    : audience === 'Posjetitelji' ? 'za posjetitelje'
      : 'za lokalne kupce i posjetitelje';
  return `${prefix ? `${prefix} ` : ''}${noun} ${audienceLabel}`;
}

function ideaTest() {
  const text = businessIdea.toLowerCase();
  if (!text) return '';
  if (/(doru|jutro|kava|coffee|brunch)/.test(text)) return 'Testirajte jutarnji ritam i vrijeme čekanja, ne samo ukupan broj prolaznika.';
  if (/(vegan|zdrav|bez glutena|vegetar)/.test(text)) return 'Prije pozicioniranja provjerite stvarnu lokalnu potražnju za specifičnom prehranom, jer OSM oznake ne bilježe cijeli jelovnik.';
  if (/(obitelj|djeca|family)/.test(text)) return 'Provjerite sigurnost pristupa, trajanje posjeta i ponudu koja olakšava dolazak obiteljima.';
  if (/(turist|obilazak|iskustv|dozivlj)/.test(text)) return 'Provjerite ritam sezone, dostupnost rezervacija i vidljiv razlog da posjetitelji odaberu upravo vaš koncept.';
  if (/(dostav|takeaway|preuzim)/.test(text)) return 'Testirajte brzinu preuzimanja i kratko zaustavljanje, jer pristup autom može biti važniji od dužeg zadržavanja.';
  return 'Pretvorite opis u jednu mjerljivu potrebu kupca koju možete testirati prije najma prostora.';
}

function personalizedAngle(base) {
  return businessIdea ? `Za ${conceptName()}: ${base} ${ideaTest()}` : base;
}

function competitionInView(focus = null) {
  return signalItems('competition').filter(item => !focus?.lat || distanceMetres(focus, item) <= 420);
}

function competitionMix(focus = null) {
  const items = competitionInView(focus);
  const groups = {coffee:0, restaurant:0, quick:0, dessert:0, unknown:0};
  const cuisines = {};
  let tagged = 0;
  items.forEach(item => {
    const category = item.category || '';
    if (['cafe', 'bar', 'pub'].includes(category)) groups.coffee += 1;
    else if (category === 'restaurant') groups.restaurant += 1;
    else if (category === 'fast_food') groups.quick += 1;
    else if (category === 'ice_cream') groups.dessert += 1;
    else groups.unknown += 1;
    if (item.cuisine) {
      tagged += 1;
      item.cuisine.split(';').map(value => value.trim().toLowerCase()).filter(Boolean).forEach(value => cuisines[value] = (cuisines[value] || 0) + 1);
    }
  });
  const topCuisine = Object.entries(cuisines).sort((a,b) => b[1] - a[1]).slice(0,3).map(([name]) => name.replaceAll('_',' '));
  return {...groups, total:items.length, tagged, topCuisine};
}

function mixLine(mix) {
  const parts = [];
  if (mix.coffee) parts.push(`${mix.coffee} kafića/barova`);
  if (mix.restaurant) parts.push(`${mix.restaurant} restorana`);
  if (mix.quick) parts.push(`${mix.quick} brze ponude`);
  if (mix.dessert) parts.push(`${mix.dessert} slastičarskih točaka`);
  return parts.slice(0,3).join(' · ') || 'nedovoljno označenih djelatnosti';
}

function workforceAdvice(market, mix) {
  const seasonal = Number.parseFloat(places[place].tour.replace(',','.')) >= 4;
  const commute = market.transit >= 3
    ? 'Stajališta olakšavaju dolazak zaposlenika bez auta.'
    : 'Za dolazak zaposlenika treba provjeriti raspored prijevoza i siguran povratak iz smjene.';
  const pressure = mix.coffee + mix.restaurant >= 12
    ? 'Gusta ponuda znači i veću borbu za iskusno smjensko osoblje.'
    : 'Otvoreni podaci ne pokazuju izražen lokalni pritisak konkurencije na zapošljavanje.';
  const retention = seasonal ? 'Za privlačenje tima prednost imaju predvidive smjene i plan zadržavanja izvan sezone.' : 'Za privlačenje tima prednost imaju stabilan raspored, jasna obuka i vidljiv put napredovanja.';
  return `${commute} ${pressure} ${retention}`;
}

function marketOpportunity(focus = null) {
  const p = places[place];
  const profile = $('#profile').value;
  const competition = nearbyCount('competition', focus);
  const parking = nearbyCount('parking', focus);
  const transit = nearbyCount('transit', focus);
  const activity = nearbyCount('attractor', focus);
  const access = transit + parking;
  const profileAdvice = profile === 'Ugostiteljstvo i prehrana'
    ? 'brzu jutarnju ponudu, preuzimanje bez čekanja ili mirniji dnevni boravak'
    : profile === 'Trgovina'
      ? 'jasan svakodnevni razlog dolaska, kratko zadržavanje ili preuzimanje bez čekanja'
      : profile === 'Turizam i doživljaji'
        ? 'kratko, rezervabilno iskustvo s jasnim razlogom za preporuku'
        : profile === 'Osobne i zdravstvene usluge'
          ? 'pouzdan termin, jednostavan dolazak i diskretnu uslugu koja potiče ponovni posjet'
          : profile === 'Stručne i digitalne usluge'
            ? 'jasnu ciljanu publiku i razlog da se sastanak ili usluga odvija upravo ovdje'
            : profile === 'Obrt i proizvodnja'
              ? 'dostavu, pristup dobavljačima i jasan model preuzimanja ili naručivanja'
        : 'jasno definiran problem kupca prije izbora formata';
  const context = competition >= 16
    ? 'Gusta ponuda potvrđuje da ljudi dolaze, ali ne potvrđuje da trebaju još isti format.'
    : competition >= 7
      ? 'Postoji aktivna ponuda bez jasnog znaka potpune zasićenosti.'
      : 'Malo evidentirane ponude može biti prilika, ali i slab signal potražnje — ne treba ga čitati kao prazno tržište.';
  const accessSignal = access >= 7
    ? 'Pristup je raznolik: vidljivi su signali dolaska bez auta i/ili kratkog parkiranja.'
    : 'Pristupni signali su ograničeni; koncept ne bi trebao ovisiti samo o spontanom prolazu.';
  const baseAngle = competition >= 16
    ? `Umjesto opće ponude, testirajte ${profileAdvice}.`
    : activity >= 3
      ? `Vežite ${profile.toLowerCase()} uz ritam obližnjih aktivnosti: testirajte ${profileAdvice}.`
      : `Prije najma provjerite može li lokacija stvarati ponovni dolazak kroz ${profileAdvice}.`;
  const angle = personalizedAngle(baseAngle);
  return {competition, parking, transit, activity, context, accessSignal, angle, total: competition + parking + transit + activity, place:p.name};
}

function signalReading(type, count, focus) {
  const market = marketOpportunity(focus);
  const readings = {
    competition: count > 1 ? `${count} označenih konkurenata čini ovu zonu čitljivom: ${market.context}` : 'Pojedinačni ugostiteljski objekt je signal aktivnosti, ne i dokaz zasićenosti.',
    parking: count > 1 ? `${count} označenih parkinga olakšava kratki dolazak autom. ${market.accessSignal}` : 'Parkiranje postoji, ali njegov kapacitet i naplatu treba potvrditi prije odluke.',
    transit: count > 1 ? `${count} stajališta podupire spontan dolazak bez automobila. ${market.accessSignal}` : 'Stajalište je blizu; provjerite učestalost linije i ritam izlazaka putnika.',
    attractor: count > 1 ? `${count} točaka aktivnosti povećava šansu za usputnu potražnju, osobito ako se njihov ritam poklapa s vašim radnim vremenom.` : 'Točka aktivnosti može stvarati posjete, no njezin raspored rada treba provjeriti.',
    market: 'Zona spaja evidentiranu ponudu s dostupnošću. Ona je početna hipoteza za testiranje koncepta, ne procjena prihoda.'
  };
  return readings[type];
}

function renderLocationCard() {
  if (isNationalView()) return;
  const p = places[place];
  const competition = signalItems('competition').length;
  const parking = signalItems('parking').length;
  const transit = signalItems('transit').length;
  const highCompetition = competition >= 80;
  const strongAccess = transit >= 20 || parking >= 8;
  const market = marketOpportunity(signalFocus);
  const mix = competitionMix(signalFocus);
  const title = highCompetition ? 'Izvedivo uz razlikovanje' : strongAccess ? 'Dobar početni kandidat' : 'Traži ciljanu provjeru';
  const ideaLead = businessIdea ? `Za ${conceptName()}, ` : '';
  const conclusion = highCompetition
    ? `${ideaLead}${p.name} ima aktivno tržište; razlikovanje je nužno.`
    : `${ideaLead}${p.name} ima solidan signal potražnje i pristupa.`;
  $('#viabilityTitle').textContent = title;
  $('#aiSummary').textContent = conclusion;
  $('#insightList').innerHTML = [
    `<li aria-label="Potražnja"><i>◎</i><span>${p.pop} stanovnika · sezona ${p.tour}</span></li>`,
    `<li aria-label="Pristup"><i>↔</i><span>${transit} stajališta · ${parking} parkinga</span></li>`,
    `<li aria-label="Tržište"><i>●</i><span>${competition} ugostitelja · ${highCompetition ? 'visoka konkurencija' : 'provjeriti ulicu'}</span></li>`
  ].join('');
  $('#opportunityHeading').textContent = signalFocus ? 'Hipoteza za odabranu zonu' : 'Kako čitati kartu';
  $('#opportunityText').textContent = signalFocus
    ? `Kupci — ${market.angle} U zoni su evidentirani ${mixLine(mix)}${mix.topCuisine.length ? `; najčešće označene kuhinje: ${mix.topCuisine.join(', ')}.` : '.'}`
    : 'Uključite sloj, zatim kliknite broj ili oznaku na karti. Umjesto pukog broja, dobit ćete poslovnu hipotezu za odabrani koncept.';
  $('#workforceText').textContent = signalFocus
    ? `Tim — ${workforceAdvice(market, mix)}`
    : 'Tim — odaberite zonu za procjenu dostupnosti dolaska i pritiska na zapošljavanje.';
  $('#focusNote').textContent = signalFocus ? `OSM pokrivenost: ${counted(mix.total, 'konkurent', 'konkurenata')}; kategorija je označena za ${mix.total - mix.unknown}, a vrsta kuhinje za ${mix.tagged}. ${signalReading(signalFocus.type, signalFocus.count, signalFocus)}` : 'Karta je primarni način istraživanja: klik na skup točaka čita odnos konkurencije, pristupa i aktivnosti baš u toj zoni.';
}

function evidence(p) {
  const competition=signalItems('competition').length, parking=signalItems('parking').length, transit=signalItems('transit').length;
  return [
    {name:'Kupci',rows:[['Stalna baza',`${p.pop} stanovnika`,'grad · Popis 2021.'],['Sezonalnost',`${p.tour} ljeto : zima`,'DZS sezonski kontekst']]},
    {name:'Dolazak',rows:[['Promet',p.traffic,'javni prometni signal'],['Dohvat',currentReach(),'procjena po cestama']]},
    {name:'Tržište na karti',rows:[['Ponuda',`${competition} ugostitelja`,'OSM evidentirani objekti'],['Pristup',`${transit} staj. · ${parking} parkinga`,'OSM pristupni signali']]}
  ];
}

function countryEvidence() {
  return [
    {name:'Što uspoređujemo',rows:[['Kupci','stanovnici + sezona','odaberite grad za lokalne vrijednosti'],['Dolazak','ceste + javni prijevoz','procjena pristupa kartom']]},
    {name:'Što ćete dobiti',rows:[['Tržište','ponuda + zone prilike','evidentirani lokalni signali'],['Pokretanje','jasan redoslijed koraka','službene početne točke']]}
  ];
}

function narrative(p) {
  return `${p.name} povezuje lokalnu bazu, sezonalnost i prometni ritam u jednu početnu sliku. Procjene ispod služe za sužavanje izbora; ne zamjenjuju podatke o konkretnom prostoru.`;
}

function monthBars(p) {
  const data = p.tour === '9,1×' ? [12,12,16,28,52,78,100,96,74,42,23,15] : p.tour === '4,2×' ? [22,20,25,38,56,75,92,96,69,45,31,24] : p.tour === '2,6×' ? [40,38,43,49,58,67,75,78,65,54,45,41] : [48,45,49,52,58,62,66,68,61,56,51,48];
  return ['Sij','Vel','Ožu','Tra','Svi','Lip','Srp','Kol','Ruj','Lis','Stu','Pro'].map((month,i) => `<div class="month"><i style="height:${data[i]}%"></i><span>${month}</span></div>`).join('');
}

function suggestedTask() {
  const p = places[place];
  if (detailMode === 'access') return {id:`${place}-prostor`,text:`Potvrditi cijenu i uvjete odabranog prostora (${p.name}).`};
  if (detailMode === 'work') return {id:`${place}-financiranje`,text:'Provjeriti aktualne uvjete financiranja za odabrani profil.'};
  return null;
}

function updatePlanCount() { $('#planCount').textContent = plan.length ? `· ${plan.length}` : ''; }

function renderPlan() {
  const suggestion = suggestedTask();
  const exists = suggestion && plan.some(item => item.id === suggestion.id);
  let content = '<p class="plan-context">U plan ulaze samo nepoznanice koje javni podaci ne mogu procijeniti.</p>';
  if (suggestion) content += exists ? `<p class="plan-added">✓ U planu: ${suggestion.text}</p>` : '<button class="plan-add" id="addPlanTask" type="button">Dodaj jednu provjeru u plan</button>';
  else content += '<p class="plan-added">Za ovaj pogled nema dodatne provjere koju javni podaci već ne pokrivaju.</p>';
  content += `<button class="plan-pdf" id="makePdf" type="button">Izradi PDF sažetak${plan.length ? ` · ${plan.length} korak${plan.length === 1 ? '' : 'a'}` : ''}</button>`;
  $('#planPanel').innerHTML = content;
  const add = $('#addPlanTask');
  if (add) add.addEventListener('click', () => { plan.push(suggestion); updatePlanCount(); renderPlan(); toast('Dodano u daljnji plan'); });
  $('#makePdf').addEventListener('click', downloadReport);
}

function renderDetails() {
  const p = places[place];
  const reach = currentReach();
  $('#dialogPlace').textContent = p.name;
  $('#dialogIntro').textContent = narrative(p);
  $$('.detail-tab').forEach(button => {
    const active = button.dataset.detail === detailMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const content = {
    overview: `<div class="detail-story"><p class="eyebrow">Sažeta procjena</p><h3>Lokalna baza može nositi osnovnu potražnju; sezona određuje koliko je prilika promjenjiva.</h3><p>${p.pop} stanovnika daje kontekst stalnoj potražnji, a omjer ${p.tour} pokazuje koliko se ritam ljeta razlikuje od zime. Za početno rangiranje područja to je dovoljno jak signal.</p></div><div class="signal-grid"><div><span>Lokalni kontekst</span><strong>${p.pop}</strong><small>stanovnika u gradu</small></div><div><span>Sezonski signal</span><strong>${p.tour}</strong><small>ljeto prema zimi</small></div><div><span>Ritam prometa</span><strong>${p.traffic}</strong><small>javni indikator</small></div></div>`,
    season: `<div class="detail-story"><p class="eyebrow">Procjena kroz godinu</p><h3>${p.name} ima ${p.tour} jači ljetni nego zimski signal.</h3><p>To sugerira kada prilagoditi kapacitet, radno vrijeme i budžet. Obrazac je prikazan na dostupnoj javnoj geografskoj razini; nije prognoza prihoda jednog prostora.</p></div><div class="month-bars" aria-label="Ilustrativni sezonski ritam">${monthBars(p)}</div><p class="detail-note">Indeks prikazuje javno dostupni sezonski obrazac za usporedbu područja.</p>`,
    access: `<div class="detail-story"><p class="eyebrow">Procjena pristupa</p><h3>${p.access.charAt(0).toUpperCase()+p.access.slice(1)} uz ${reach.toLowerCase()} dohvata.</h3><p>Prometni signal je ${p.traffic.toLowerCase()}, a stvarni kartografski kontekst čine cesta, stajališta i parkiranje. Njihove zasebne slojeve uključi na karti; crte i točke nisu simulirane.</p></div><div class="access-strip"><div><span>Procijenjeni pristup</span><strong>${p.access}</strong></div><div><span>Radni dohvat</span><strong>${reach}</strong></div></div>`,
    work: `<div class="detail-story"><p class="eyebrow">Operativna procjena</p><h3>Trend djelatnosti je ${p.work}; lokacija nije označena kao operativno nepovoljna.</h3><p>Nacionalni trend nije lokalna prognoza zapošljavanja, ali u kombinaciji s profilom i javnim programima daje dovoljno za rani odabir. Aktualni uvjeti financiranja jedina su promjenjiva stavka.</p></div><div class="signal-grid two"><div><span>Trend djelatnosti</span><strong>${p.work}</strong><small>godišnja promjena</small></div><div><span>Financiranje</span><strong>Otvoreno</strong><small>provjera aktualnih uvjeta</small></div></div>`
  };
  $('#measureList').innerHTML = content[detailMode];
  renderPlan();
}

function pin(id) {
  return L.divIcon({className:'',html:`<div class="map-pin ${id === place ? 'selected' : ''}"></div>`,iconSize:[20,20],iconAnchor:[10,10],tooltipAnchor:[13,-8]});
}

function clearOverlays() { mapOverlays.forEach(layer => map.removeLayer(layer)); mapOverlays = []; }
function addOverlay(layer) { layer.addTo(map); mapOverlays.push(layer); return layer; }
function clearRoads() { roadOverlays.forEach(layer => map.removeLayer(layer)); roadOverlays = []; }
function addRoad(layer) { layer.addTo(map); roadOverlays.push(layer); return layer; }
function clearBuildings() { buildingOverlays.forEach(layer => map.removeLayer(layer)); buildingOverlays = []; }
function addBuilding(layer) { layer.addTo(map); buildingOverlays.push(layer); return layer; }
function signalTooltip(item, label) { return `${label}${item.name ? ` · ${item.name}` : ''}`; }
function pointIcon(letter, className, count=1) { return L.divIcon({className:'',html:`<span class="signal-pin ${className} ${count > 1 ? 'signal-cluster' : ''}">${letter}</span>`,iconSize:[count > 1 ? 24 : 18,count > 1 ? 24 : 18],iconAnchor:[count > 1 ? 12 : 9,count > 1 ? 12 : 9]}); }
function signalGroups(type) {
  const cellSize = map.getZoom() >= 17 ? 20 : map.getZoom() >= 15 ? 28 : 38;
  const groups = new Map();
  signalItems(type).forEach(item => {
    const point = map.latLngToLayerPoint([item.lat,item.lng]);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const group = groups.get(key) || {items:[],lat:0,lng:0};
    group.items.push(item); group.lat += item.lat; group.lng += item.lng;
    groups.set(key,group);
  });
  return [...groups.values()].map(group => ({...group,lat:group.lat/group.items.length,lng:group.lng/group.items.length}));
}
function renderMapLegend() {
  if (isNationalView()) {
    $('#mapLegend').innerHTML = '<span><b>1</b>potražnja</span><span><b>2</b>dostupnost</span><span><b>3</b>izvedivost</span>';
    return;
  }
  const labels = {competition:['●','Ugostitelji'],parking:['P','Parkiranje'],transit:['↔','Stajališta'],attractor:['+','Aktivnost']};
  const network = visibleLayers.has('roadReach') ? [`<span class="legend-road"><b>↝</b>${currentReach()} po cestama</span>`] : [];
  const pulse = visibleLayers.has('marketPulse') ? ['<span class="legend-test"><b>+</b>prostor za test</span>','<span class="legend-active"><b>↗</b>aktivan čvor</span>','<span class="legend-dense"><b>●</b>puno ponude</span>'] : [];
  const items = Object.entries(labels).filter(([type])=>visibleLayers.has(type)).map(([type,[symbol,label]])=>`<span class="legend-${type}"><b>${symbol}</b>${signalItems(type).length} ${label.toLowerCase()}</span>`);
  $('#mapLegend').innerHTML = [...network,...pulse,...items].length ? [...network,...pulse,...items].join('') : '<span>Uključite sloj za prikaz stvarnih točaka.</span>';
}

function renderRoadReach() {
  const reach = roadReachability(place,Number(currentReach().split(' ')[0]));
  if (!reach.reachable.length) return;
  const envelope=reachEnvelope(reach.origin,reach.reachable);
  addOverlay(L.polygon(envelope,{color:'#2d7775',weight:1.4,dashArray:'5 6',fillColor:'#4c9e98',fillOpacity:.13,interactive:false,pane:'overlayPane'}).bindTooltip(`${currentReach()} po cestama · procjena`,{permanent:true,direction:'bottom',className:'road-reach-label'}));
  const axes = new Map();
  reach.reachableSegments.filter(segment => ['trunk','primary','secondary'].includes(segment.kind)).forEach(segment => axes.set(segment.road.points,segment.road));
  [...axes.values()].forEach(road => {
    const weight=road.kind==='trunk'?3.2:road.kind==='primary'?2.5:1.8;
    addOverlay(L.polyline(road.points,{color:'#d36b4e',weight,opacity:.72,lineCap:'round',interactive:false,pane:'overlayPane'}));
  });
  addOverlay(L.circleMarker([reach.origin.lat,reach.origin.lng],{radius:6,color:'#171716',weight:2,fillColor:'#f7f5ef',fillOpacity:1,interactive:false,pane:'markerPane'}).bindTooltip('Polazište cestovne procjene',{direction:'top',className:'estimate-label'}));
}

function renderMarketPulse() {
  const p=places[place], cells=new Map(), size=.006;
  ['competition','parking','transit','attractor'].forEach(type => signalItems(type).forEach(item => {
    const key=`${Math.floor((item.lat-p.lat)/size)}:${Math.floor((item.lng-p.lng)/size)}`;
    const cell=cells.get(key)||{lat:0,lng:0,total:0,competition:0,parking:0,transit:0,attractor:0};
    cell.lat+=item.lat; cell.lng+=item.lng; cell.total++; cell[type]++; cells.set(key,cell);
  }));
  const fields=[...cells.values()].map(cell => ({...cell,lat:cell.lat/cell.total,lng:cell.lng/cell.total,access:cell.transit+cell.parking,score:cell.transit*2+cell.parking*2+cell.attractor*2+Math.min(cell.competition,8)*.45})).filter(cell => cell.score>=4).sort((a,b)=>b.score-a.score);
  const selected=[], kinds={test:0,active:0,dense:0};
  fields.forEach(field => {
    const kind=field.access>=6 && field.competition<=8 ? 'test' : field.competition>=20 ? 'dense' : 'active';
    if(selected.length>=4 || kinds[kind]>=2) return;
    kinds[kind]++; selected.push({...field,kind});
  });
  const labels={test:{mark:'+',title:'Prostor za test',detail:'dobar pristup · manje ponude'},active:{mark:'↗',title:'Aktivan čvor',detail:'vidljiv pristup i aktivnost'},dense:{mark:'●',title:'Puno ponude',detail:'dokazana potražnja · jača konkurencija'}};
  selected.forEach(field => {
    const meta=labels[field.kind];
    const summary=[field.transit&&`${field.transit} staj.`,field.parking&&`${field.parking} parking`,field.competition&&`${field.competition} ugost.`].filter(Boolean).join(' · ');
    const icon=L.divIcon({className:'',html:`<span class="market-pulse ${field.kind}" role="button" tabindex="0" aria-label="${meta.title}">${meta.mark}</span>`,iconSize:[28,28],iconAnchor:[14,14]});
    const marker=L.marker([field.lat,field.lng],{icon,keyboard:true,title:meta.title,zIndexOffset:250,riseOnHover:true}).bindTooltip(`<strong>${meta.title}</strong><br>${meta.detail}<br><small>${summary}</small>`,{direction:'top',className:'market-pulse-label'});
    const selectZone=()=>{signalFocus={type:'market',count:field.total,lat:field.lat,lng:field.lng};renderLocationCard();};
    marker.on('click',selectZone);
    marker.once('add',()=>{
      const badge=marker.getElement()?.querySelector('.market-pulse');
      badge?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();selectZone();});
      badge?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectZone();}});
    });
    addOverlay(marker);
  });
}

function renderMapOverlays() {
  if (!map) return;
  clearOverlays();
  const p = places[place];
  const radius = currentRadius() * 1000;
  if (visibleLayers.has('reach')) {
    addOverlay(L.circle([p.lat,p.lng],{radius,color:'#d63b24',weight:1.5,dashArray:'5 6',fillColor:'#d63b24',fillOpacity:.06,interactive:false}).bindTooltip(`${currentReach()} · modelirani dohvat`,{permanent:true,direction:'bottom',className:'estimate-label'}));
  }
  if (visibleLayers.has('demand')) {
    addOverlay(L.circle([p.lat,p.lng],{radius:radius*.58,color:'#aa6b21',weight:1,fillColor:'#d8aa65',fillOpacity:.16,interactive:false}).bindTooltip(`Stanovništvo grada: ${p.pop} · Popis 2021.`,{permanent:true,direction:'top',className:'estimate-label'}));
  }
  if (visibleLayers.has('roadReach')) renderRoadReach();
  if (visibleLayers.has('marketPulse')) renderMarketPulse();
  const configurations = {
    competition:{letter:'●',className:'competitor-pin',label:'Ugostiteljski objekt',plural:'ugostiteljskih objekata'},
    parking:{letter:'P',className:'parking-pin',label:'Parkiranje',plural:'parkinga'},
    transit:{letter:'↔',className:'transit-pin',label:'Stajalište',plural:'stajališta'},
    attractor:{letter:'+',className:'attractor-pin',label:'Točka aktivnosti',plural:'točaka aktivnosti'}
  };
  Object.entries(configurations).forEach(([type,config]) => {
    if (!visibleLayers.has(type)) return;
    signalGroups(type).forEach(group => {
      const count = group.items.length;
      const label = count > 1 ? `${count} ${config.plural} u ovom dijelu` : signalTooltip(group.items[0],config.label);
      const marker = L.marker([group.lat,group.lng],{icon:pointIcon(count > 1 ? count : config.letter,config.className,count),keyboard:true}).bindTooltip(label,{direction:'top',className:'estimate-label'});
      marker.on('click',()=>{ signalFocus={type,count,lat:group.lat,lng:group.lng}; renderLocationCard(); });
      addOverlay(marker);
    });
  });
  renderMapLegend();
}

function roadStyle(kind) {
  const styles = {
    motorway:{color:'#c7754f',weight:4.5,opacity:.88}, trunk:{color:'#d08b5b',weight:4,opacity:.88},
    primary:{color:'#d99061',weight:3.4,opacity:.9}, secondary:{color:'#e2b778',weight:2.8,opacity:.9},
    tertiary:{color:'#e8cea4',weight:2.25,opacity:.95}, unclassified:{color:'#c8c5bb',weight:1.65,opacity:.95},
    residential:{color:'#fffdf8',weight:1.4,opacity:.96}, living_street:{color:'#fffdf8',weight:1.2,opacity:.9}
  };
  return styles[kind] || styles.residential;
}

function renderRoadNetwork() {
  if (!map) return;
  clearRoads();
  const priority = {residential:0,living_street:0,unclassified:1,tertiary:2,secondary:3,primary:4,trunk:5,motorway:6};
  const roads = [...(mapRoads.places?.[place] || [])].sort((a,b) => priority[a.kind] - priority[b.kind]);
  roads.forEach(road => addRoad(L.polyline(road.points,{...roadStyle(road.kind),interactive:false,pane:'roads'})));
}

function renderBuildingContext() {
  if (!map) return;
  clearBuildings();
  if (map.getZoom() < 13) return;
  (mapRoads.buildings?.[place] || []).forEach(building => addBuilding(L.polygon(building.points,{color:'#c5c0b7',weight:.45,opacity:.72,fillColor:'#dbd7cf',fillOpacity:.78,interactive:false,pane:'buildings'})));
}

function setBaseMap() {
  if (!map || !nationalTiles) return;
  nationalTiles.setOpacity(.82);
  nationalTiles.getContainer()?.classList.add('business-basemap');
}

function localOsmLayer() {
  const LocalTiles = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      canvas.width = size.x; canvas.height = size.y;
      const context = canvas.getContext('2d');
      let zoom = coords.z;
      const load = () => {
        const scale = 2 ** (coords.z - zoom);
        const x = Math.floor(coords.x / scale);
        const y = Math.floor(coords.y / scale);
        const image = new Image();
        image.onload = () => {
          const crop = size.x / scale;
          context.drawImage(image, (coords.x % scale) * crop, (coords.y % scale) * crop, crop, crop, 0, 0, size.x, size.y);
          done(null, canvas);
        };
        image.onerror = () => { if (zoom > 6) { zoom -= 1; load(); } else done(null, canvas); };
        image.src = `assets/tiles/${zoom}/${x}/${y}.png`;
      };
      load();
      return canvas;
    }
  });
  return new LocalTiles({minZoom:6,maxZoom:18,attribution:'© OpenStreetMap contributors · lokalna kopija'});
}

function setupMap() {
  if (!window.L) { toast('Karta se nije učitala.'); return; }
  map = L.map('mapCanvas',{zoomControl:true,attributionControl:true,minZoom:6,maxZoom:18,scrollWheelZoom:true,doubleClickZoom:true,touchZoom:true,boxZoom:true,keyboard:true}).setView([44.6,16.3],7);
  nationalTiles = localOsmLayer().addTo(map);
  map.createPane('roads');
  map.getPane('roads').style.zIndex = 240;
  map.createPane('buildings');
  map.getPane('buildings').style.zIndex = 210;
  map.attributionControl.setPrefix('');
  map.attributionControl.addAttribution('Ceste i točke: © OpenStreetMap contributors');
  map.on('zoomend', () => { setBaseMap(); render(); });
  map.on('moveend', setBaseMap);
  Object.entries(places).forEach(([id,p]) => {
    const marker = L.marker([p.lat,p.lng],{icon:pin(id),keyboard:true,title:p.name}).addTo(map).bindTooltip(p.name,{permanent:false,direction:'right',className:'marker-label'});
    marker.on('click',() => choose(id,true));
    markers[id] = marker;
  });
}

function renderMap() {
  if (!map) return;
  Object.entries(markers).forEach(([id,marker]) => marker.setIcon(pin(id)));
  setBaseMap();
  clearBuildings(); clearRoads();
  if (isNationalView()) { clearOverlays(); renderMapLegend(); return; }
  renderMapOverlays();
}

function renderCandidates() {
  const footer = $('.sidebar-foot');
  footer.innerHTML = `<span id="areaCount">${candidates.length} ${candidates.length === 1 ? 'GRAD' : 'GRADA'} U SCENARIJU</span>${candidates.map(id => `<button class="candidate ${id === place ? 'selected' : ''}" data-place="${id}"><i></i>${places[id].name}</button>`).join('')}<button id="add" class="add">Dodaj grad</button>`;
  $$('.candidate').forEach(button => button.addEventListener('click',() => choose(button.dataset.place)));
  $('#add').addEventListener('click', openAreaPicker);
}

function render() {
  const p = places[place];
  const national = isNationalView();
  const sets = national ? countryEvidence() : evidence(p);
  if (national) $('.drawer').classList.add('closed');
  $('#sidePlace').textContent = national ? 'Hrvatska' : p.name;
  $('#openEvidence').textContent = national ? 'Odaberite grad ↗' : 'Više o području ↗';
  $('#captionLayer').textContent = national ? 'Hrvatska · početni poslovni pregled' : p.name + ' · javni pokazatelji';
  $('#captionCatchment').textContent = national ? 'zumirajte ili odaberite grad' : visibleLayers.has('roadReach') ? `${currentReach()} · procjena po cestama` : currentReach() + ' · približan dohvat';
  $('.map-layers').hidden = national;
  $$('.map-layer[data-layer]').forEach(button => { button.hidden = national; });
  $('#evidenceModules').innerHTML = sets.map(set => `<article class="evidence-module"><div><h2>${set.name}</h2></div>${set.rows.map(row => `<p><span>${row[0]}</span><strong>${row[1]}</strong><em>${row[2]}</em></p>`).join('')}</article>`).join('');
  renderLocationCard();
  renderDetails();
  renderCandidates();
  renderMap();
}

function choose(id,move=true) {
  if (!places[id]) return;
  place = id;
  signalFocus = null;
  refreshLiveOsm(id);
  if (move && map) {
    map.flyTo([places[id].lat,places[id].lng],14,{duration:.45});
    window.setTimeout(() => { $('.drawer').classList.remove('closed'); render(); }, 520);
    return;
  }
  $('.drawer').classList.remove('closed');
  render();
}

function openAreaPicker() {
  const available=Object.keys(places).filter(id=>!candidates.includes(id));
  if (!available.length) return toast('Sva ogledna mjesta već su u scenariju');
  $('#areaChoices').innerHTML=available.map(id=>{const p=places[id];return `<button class="area-choice" data-place="${id}"><strong>${p.name}</strong><span>${p.pop} stanovnika · sezona ${p.tour}</span><b>Dodaj →</b></button>`;}).join('');
  $$('.area-choice').forEach(button=>button.addEventListener('click',()=>addCandidate(button.dataset.place)));
  $('#areaDialog').showModal();
}

function addCandidate(id) {
  if (!places[id] || candidates.includes(id)) return;
  candidates.push(id);
  $('#areaDialog').close();
  choose(id);
  toast(`${places[id].name} dodan za usporedbu`);
}

function cleanPdf(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/×/g,'x').replace(/[()\\]/g,'\\$&'); }
function wrapPdf(text,width=82) { const words=cleanPdf(text).split(/\s+/),lines=[]; let line=''; words.forEach(word=>{ if ((line+' '+word).trim().length>width) { lines.push(line); line=word; } else line=(line+' '+word).trim(); }); if(line) lines.push(line); return lines; }
function highLevelSummary(p, market, mix) {
  const dense = mix.coffee + mix.restaurant + mix.quick >= 60;
  const title = dense ? 'Izvedivo uz jasno razlikovanje' : market.transit + market.parking >= 7 ? 'Dobar kandidat za daljnju provjeru' : 'Potrebna je ciljana provjera mikrolokacije';
  const body = dense
    ? `${p.name} pokazuje dokazanu aktivnost kupaca i pristup, ali otvoreni podaci otkrivaju gustu evidentiranu ponudu. Odluka ima smisla samo ako koncept rjesava odredenu potrebu kupca jasnije od postojece ponude i ako je plan zapošljavanja odrziv kroz sezonu.`
    : `${p.name} spaja lokalnu bazu, pristupne signale i evidentiranu ponudu u dovoljno dobar pocetni signal. Prije najma treba provjeriti konkretan prostor, trosak i stvarnu dostupnost tima.`;
  const tailored = businessIdea ? ` Koncept ${conceptName()} vodi sljedeći test: ${ideaTest()}` : '';
  return {title, body:body + tailored};
}

function pdfOfferReading(mix) {
  if (!mix.total) return 'Ponuda se ne kvantificira dok se lokalni kartografski sloj ne učita.';
  const types = mixLine(mix);
  if (mix.total < 4 || types === 'nedovoljno označenih djelatnosti') return `Karta bilježi ${mix.total} poslovne točke, ali nema dovoljno oznaka za pouzdanu podjelu ponude po vrstama.`;
  const cuisine = mix.topCuisine.length ? ` Najčešće označene kuhinje: ${mix.topCuisine.join(', ')}.` : '';
  return `Evidentirano je ${types}.${cuisine}`;
}

function pdfConclusion(p, market, mix, summary) {
  const access = market.transit || market.parking
    ? `${market.transit} stajališta i ${market.parking} parkinga iz lokalne OSM snimke`
    : 'procjena dostupnosti iz lokalne OSM snimke';
  const offer = mix.total ? `${mix.total} evidentiranih konkurenata` : 'kvalitativna provjera ponude na karti';
  return `Zaključak se temelji na ${p.pop} stanovnika (DZS), sezonalnosti ${p.tour} (DZS sezonski kontekst), ${access} te ${offer}. Ti signali zajedno upućuju na to da je ${summary.title.toLowerCase()}. ${businessIdea ? `Za opisani koncept prioritet je ${ideaTest().replace(/^Testirajte /,'testirati ').replace(/^Provjerite /,'provjeriti ').replace(/^Pretvorite /,'pretvoriti ')}` : 'Prije odluke treba provjeriti konkretan prostor i trošak najma.'}`;
}

function pdfCustomerReading(market) {
  const position = market.competition >= 16
    ? 'Gusta ponuda potvrđuje aktivnost, ali traži jasno razlikovanje koncepta.'
    : market.activity >= 3
      ? 'Obližnje aktivnosti daju razlog za testiranje ponovnog dolaska kupaca.'
      : 'Potražnju treba potvrditi kratkim testom prije ugovaranja prostora.';
  return businessIdea ? `Za ${conceptName()}: ${position}` : position;
}

function pdfWorkforceReading(market) {
  const access = market.transit >= 3 ? 'Stajališta olakšavaju dolazak tima bez auta.' : 'Raspored prijevoza treba uskladiti sa smjenama.';
  const season = Number.parseFloat(places[place].tour.replace(',','.')) >= 4
    ? 'Sezona traži raniji plan zapošljavanja i zadržavanja.'
    : 'Stabilniji ritam pogoduje predvidivom rasporedu rada.';
  return `${access} ${season}`;
}

function downloadReport() {
  const p=places[place];
  const market = marketOpportunity(signalFocus);
  const mix = competitionMix(signalFocus);
  const summary = highLevelSummary(p, market, mix);
  const nextSteps = plan.length ? plan.map(item => item.text) : [
    'Potvrditi namjenu i uvjete odabranog prostora prije potpisa najma.',
    'Testirati odabranu potrebu kupaca s malim pilotom ili razgovorima na lokaciji.',
    'Provjeriti uvjete zapošljavanja, raspored prijevoza i relevantne dozvole kod nadležnih tijela.'
  ];
  const ops=[];
  const fill = (r,g,b) => ops.push(`${r} ${g} ${b} rg`);
  const rect = (x,y,w,h) => ops.push(`${x} ${y} ${w} ${h} re f`);
  const text = (x,y,size,value,bold=false,color='0.09 0.09 0.09') => {
    ops.push(`${color} rg`, `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${cleanPdf(value)}) Tj ET`);
  };
  const rule = (y) => ops.push('0.80 0.78 0.73 RG 0.65 w', `48 ${y} m 547 ${y} l S`);
  const paragraph = (x,y,value,width=82,size=9.3,leading=13,bold=false,color='0.09 0.09 0.09') => {
    const lines=wrapPdf(value,width); lines.forEach((line,index)=>text(x,y-index*leading,size,line,bold,color)); return y-lines.length*leading;
  };
  const clipped = (value,max=180) => value.length > max ? `${value.slice(0,max-1).trimEnd()}…` : value;
  const meta = (x,width,label,value) => {
    text(x,676,7,`${label}:`,true,'0.38 0.37 0.34');
    const lines=wrapPdf(value,Math.max(15,Math.floor(width/4.6))).slice(0,2);
    lines.forEach((line,index)=>text(x,665-index*9,8,line,true));
  };
  const ideaDescription = businessIdea ? `IDEJA: ${clipped(businessIdea,190)}` : `IDEJA: ${conceptName()}`;
  const currentState = `Kupci: ${p.pop} stanovnika i sezonalnost ${p.tour}. Dolazak: ${market.transit} stajališta i ${market.parking} parkinga u lokalnoj OSM snimci. Ponuda: ${pdfOfferReading(mix)}`;
  const conclusion = pdfConclusion(p, market, mix, summary);
  fill(.09,.09,.09); rect(0,700,595,142);
  text(48,805,11,'KUNA  /  LOKALNI TRZISNI KOMPAS',true,'0.96 0.95 0.91');
  text(48,774,28,`Radni sazetak: ${p.name}`,true,'0.96 0.95 0.91');
  paragraph(48,748,ideaDescription,88,10,13,false,'0.82 0.81 0.76');
  text(456,804,8,'GENERIRANO LOKALNO',true,'0.90 0.42 0.32');
  text(456,786,9,'KUNA · radna verzija',false,'0.96 0.95 0.91');
  fill(.93,.91,.86); rect(48,643,499,44);
  meta(60,155,'PROFIL',$('#profile').value.toUpperCase());
  meta(226,155,'KUPCI',$('#audience').value.toUpperCase());
  meta(392,143,'DOHVAT',currentReach().toUpperCase());
  let y=619;
  text(48,y,9,'TRENUTNO STANJE',true,'0.84 0.23 0.14'); y-=19;
  y=paragraph(48,y,currentState,92,9.25,12)-10;
  rule(y); y-=23;
  const cardsY=y-106;
  fill(.94,.92,.87); rect(48,cardsY,241,96); fill(.95,.95,.92); rect(306,cardsY,241,96);
  text(61,cardsY+83,9,'KUPCI - HIPOTEZA',true,'0.84 0.23 0.14');
  paragraph(61,cardsY+64,pdfCustomerReading(market),35,9,12);
  text(319,cardsY+83,9,'TIM - ZAPOSLJAVANJE',true,'0.84 0.23 0.14');
  paragraph(319,cardsY+64,pdfWorkforceReading(market),35,9,12);
  y=cardsY-27;
  text(48,y,9,'ZAKLJUCAK',true,'0.84 0.23 0.14'); y-=18;
  text(48,y,14,summary.title,true); y-=18;
  y=paragraph(48,y,conclusion,92,9.15,12)-11;
  rule(y); y-=18;
  text(48,y,9,'SLJEDECI KORACI',true,'0.84 0.23 0.14'); y-=18;
  nextSteps.slice(0,3).forEach((step,index)=>{
    text(48,y,9,`${index+1}.`,true,'0.84 0.23 0.14');
    const after=paragraph(64,y,step,78,9.2,12); y=after-5;
  });
  rule(62);
  text(48,43,8,'Napomena: analiza koristi javne pokazatelje i lokalnu OSM snimku; ne procjenjuje prihod, placu ni pravne uvjete.',false,'0.38 0.37 0.34');
  text(48,29,8,'Izvori: DZS / javni lokalni pokazatelji / OpenStreetMap. Provjerite aktualnost prije odluke.',false,'0.38 0.37 0.34');
  const stream=ops.join('\n');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n'; const offsets=[0]; objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}); const start=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(value=>`${String(value).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const link=document.createElement('a'); link.href=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})); link.download=`kuna-${place}-sazetak.pdf`; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),500); toast('PDF sažetak je preuzet');
}

$('#close').addEventListener('click',()=>$('.drawer').classList.add('closed'));
function openDetails() { detailMode='overview'; renderDetails(); $('#sourceDialog').showModal(); }
function openIdeaDialog() {
  $('#ideaProfile').value = $('#profile').value;
  $('#ideaAudience').value = $('#audience').value;
  $('#ideaDescription').value = businessIdea;
  if (!$('#ideaDialog').open) $('#ideaDialog').showModal();
}
function saveIdea() {
  $('#profile').value = $('#ideaProfile').value;
  $('#audience').value = $('#ideaAudience').value;
  businessIdea = $('#ideaDescription').value.trim();
  rememberIdeaState();
  sessionStorage.setItem('kuna-idea-seen','1');
  $('#ideaDialog').close();
  render();
  toast(businessIdea ? 'Ideja je uključena u analizu' : 'Scenarij je ažuriran');
}
function openLaunchPlan() {
  const p = places[place];
  $('#launchTitle').textContent = `Plan pokretanja · ${p.name}`;
  $('#launchSteps').innerHTML = `<ul class="check-list"><li><a href="https://ispu.mgipu.hr/" target="_blank" rel="noreferrer"><strong>Potvrdi prostor.</strong><span>Prostorni plan i uvjeti lokacije</span><b>↗</b></a></li><li><a href="https://web.dzs.hr/App/NKD_Browser/" target="_blank" rel="noreferrer"><strong>Odaberi oblik i NKD.</strong><span>Pronađi ispravnu šifru djelatnosti</span><b>↗</b></a></li><li><a href="https://start.gov.hr/st/index.html" target="_blank" rel="noreferrer"><strong>Pokreni registraciju.</strong><span>START za d.o.o., j.d.o.o. i obrt</span><b>↗</b></a></li><li><a href="https://www.hzz.hr/" target="_blank" rel="noreferrer"><strong>Pripremi početak rada.</strong><span>Pronađi kanal za zapošljavanje</span><b>↗</b></a></li></ul>`;
  $('#launchDialog').showModal();
}

function assistantContext() {
  const p=places[place], market=marketOpportunity(signalFocus), mix=competitionMix(signalFocus);
  return {
    location:p.name,
    business:{profile:$('#profile').value,audience:$('#audience').value,description:businessIdea || 'Nije upisan opis.'},
    publicData:{
      population:`${p.pop} (Popis 2021.)`,seasonality:p.tour,traffic:p.traffic,
      osm:{competition:market.competition,parking:market.parking,transitStops:market.transit,activityPoints:market.activity,offerMix:mixLine(mix),taggedCuisines:mix.topCuisine}
    },
    provenance:{population:'DZS / Popis 2021.',seasonality:'javni sezonski pokazatelj',map:'OpenStreetMap API i lokalni snimak',liveOsmForSelectedPlace:liveOsm.place === place ? liveOsm.retrievedAt : null},
    mapFocus:signalFocus ? {type:signalFocus.type,count:signalFocus.count} : 'Nije odabrana pojedina zona.'
  };
}

function openAssistant() {
  if (isNationalView()) return toast('Za AI pitanje najprije odaberite grad na karti.');
  $('#assistantAnswer').hidden=true;
  $('#assistantStatus').textContent='Besplatni lokalni LLM odgovara kada je Ollama pokrenut.';
  if (!$('#assistantDialog').open) $('#assistantDialog').showModal();
  setTimeout(()=>$('#assistantQuestion').focus(),30);
}

async function askAssistant(event) {
  event.preventDefault();
  const question=$('#assistantQuestion').value.trim(), submit=$('#assistantForm button[type="submit"]');
  if (!question) return;
  submit.disabled=true; $('#assistantStatus').textContent='KUNA AI čita kontekst karte…';
  const answer=$('#assistantAnswer'); answer.hidden=true; answer.replaceChildren();
  try {
    const response=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,context:assistantContext()})});
    const payload=await response.json();
    if (!response.ok) throw new Error(payload.error || 'AI odgovor nije dostupan.');
    const title=document.createElement('strong'), body=document.createElement('p');
    title.textContent=`Odgovor · ${payload.provider || 'LLM'}${payload.model ? ` · ${payload.model}` : ''}`;
    body.textContent=payload.answer;
    answer.replaceChildren(title,body); answer.hidden=false;
    $('#assistantStatus').textContent='Odgovor je generiran iz prikazanog konteksta.';
  } catch (error) {
    $('#assistantStatus').textContent=error.message || 'AI odgovor nije dostupan.';
  } finally { submit.disabled=false; }
}

$('#openEvidence').addEventListener('click',()=>isNationalView() ? toast('Odaberite grad na karti za detaljnu procjenu') : openDetails());
$('#editIdea').addEventListener('click',openIdeaDialog);
$('#sources').addEventListener('click',openDetails);
$('#askKuna').addEventListener('click',openAssistant);
$('#askKunaCard').addEventListener('click',openAssistant);
$$('.dialog-close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('.detail-tab').forEach(button=>button.addEventListener('click',()=>{detailMode=button.dataset.detail;renderDetails();}));
$('#report').addEventListener('click',downloadReport);
$('#launchPlan').addEventListener('click',openLaunchPlan);
$('#saveIdea').addEventListener('click',saveIdea);
$('#skipIdea').addEventListener('click',()=>{sessionStorage.setItem('kuna-idea-seen','1');$('#ideaDialog').close();});
$('#assistantForm').addEventListener('submit',askAssistant);
$('#drive').addEventListener('click',()=>{const values=['15 min','30 min','45 min'],now=currentReach(),next=values[(values.indexOf(now)+1)%values.length];$('#drive').innerHTML=`${next} <span>⌄</span>`;render();});
$('#profile').addEventListener('change',()=>{rememberIdeaState();renderLocationCard();});
$('#audience').addEventListener('change',()=>{rememberIdeaState();renderLocationCard();});
$('#search').addEventListener('keydown',event=>{if(event.key==='Enter'){const query=event.target.value.toLowerCase(),id=Object.keys(places).find(key=>key.includes(query)||places[key].name.toLowerCase().includes(query));id?choose(id):toast('Mjesto nije u oglednom skupu');}});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#search').focus();}});
$$('.map-layer').forEach(button=>button.addEventListener('click',()=>{const name=button.dataset.layer;if (!name) return; visibleLayers.has(name)?visibleLayers.delete(name):visibleLayers.add(name);button.classList.toggle('active',visibleLayers.has(name));if (!isNationalView()) renderMapOverlays();}));
restoreIdeaState();
setupMap();
updatePlanCount();
render();
Promise.all([
  fetch('assets/data/osm-signals.json',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject()),
  fetch('assets/data/osm-roads.json',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject())
]).then(([signals,roads])=>{mapSignals=signals;mapRoads=roads;render();refreshLiveOsm(place);}).catch(()=>toast('Kartografski slojevi nisu dostupni.'));
window.addEventListener('resize',()=>map?.invalidateSize());
setTimeout(()=>map?.invalidateSize(),120);
setTimeout(()=>{ if (!sessionStorage.getItem('kuna-idea-seen')) openIdeaDialog(); },220);
