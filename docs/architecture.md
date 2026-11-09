# Arhitektura prototipa i produkcijski put

Ovaj predajni paket je statični prototip. Pokreće ga Nodeov `server.mjs`, a sva logika sučelja i pripremljeni demonstracijski podaci nalaze se u `app.js` i `assets/data`. Time je dovoljno kopirati ili zapakirati cijelu mapu bez instalacije paketa.

Produkcijska arhitektura:

`data.gov.hr / izdavateljski API, CSV, XLSX, WMS/WFS -> adapteri izvora -> provjera i normalizacija + spremište provenijencije -> PostgreSQL/PostGIS -> servis scenarija -> React/TypeScript sučelje i izvještaj`

Najvažniji ugovori su `EvidenceMetric` (vrijednost, period, geografija, izvor i pouzdanost) te odvojeno pohranjene težine korisnika. Težine ne proizvode skriveni „najbolji” rezultat; služe za filtriranje i objašnjenje prioriteta. Generiranje teksta smije primiti samo strukturirane metrike s citatima i mora iznijeti nepoznanice.

## Integracije u ovoj verziji

- `GET /api/open-data/osm?place=...` je server-side adapter za mali, svježi OpenStreetMap API snimak. Normalizira samo poslovno relevantne točke i spaja ih s ugrađenim offline snimkom. Odgovor je memorijski cacheiran 30 minuta kako javni API ne bi bio nepotrebno opterećen.
- `POST /api/assistant` šalje samo agregirani kontekst koji korisnik vidi i njegovo pitanje lokalnoj Ollami. Lokalni LLM je zadani način rada (`qwen2.5:3b`); bez pokrenute Ollame API vraća vidljivo stanje pogreške, nikad unaprijed napisani odgovor. Opcionalni OpenAI adapter aktivira se samo server-side varijablama okruženja.
