# Kuna — Lokalni tržišni kompas RH

Samostalni, statični natjecateljski prototip za usporedbu poslovnih lokacija uz javne izvore. Cijelo korisničko sučelje je na hrvatskom jeziku.

## Transparentnost rješenja

Umjetna inteligencija korištena je kao pomoć pri izradi ovog rješenja. KUNA je simboličan, demonstracijski prototip: ne jamčimo točnost, potpunost ni aktualnost podataka, niti zaključci predstavljaju financijski, pravni, porezni ili investicijski savjet. Prije odluke treba provjeriti aktualne izvorne podatke, konkretan prostor i uvjete nadležnih tijela.

## Pokretanje

Potreban je Node.js 18 ili noviji.

```bash
npm start
```

Otvorite `http://localhost:4173`. Nema instalacije Node paketa. Ugrađeni snimak omogućuje osnovni offline prikaz, a aplikacija uz mrežu osvježava OSM podatke preko službenog javnog API-ja.

### Besplatni lokalni AI (preporučeno)

KUNA AI nije unaprijed napisan odgovor: kada je lokalni model dostupan, pitanje korisnika zajedno s prikazanim agregiranim kontekstom šalje se lokalnoj Ollami. Nema API troška ni slanja pitanja van računala.

1. Instalirajte [Ollamu](https://ollama.com/download).
2. Jednom preuzmite manji model: `ollama pull qwen2.5:3b`.
3. Pokrenite Ollamu, zatim u drugom terminalu `npm start`.

Zadani lokalni endpoint je `http://127.0.0.1:11434`, a model se može promijeniti varijablom `OLLAMA_MODEL`. Ako Ollama nije pokrenuta, aplikacija to pokaže bez izmišljanja AI odgovora.

### Opcionalni OpenAI adapter

Ako tim svjesno želi koristiti plaćeni OpenAI API, ključ ostaje samo na lokalnom serveru:

```bash
AI_PROVIDER=openai OPENAI_API_KEY=... npm start
```

Podrazumijevani OpenAI model je `gpt-5.4-mini`; može se promijeniti s `OPENAI_MODEL`. Ključ se nikad ne upisuje u `index.html`, klijentski JavaScript ni ZIP paket.

## Predaja

Za slanje žiriju upotrijebite `outputs/lokalni-trzisni-kompas.zip`. Sadrži izvorni kod, dokumentaciju i SVG oznaku, bez nepotrebnih ovisnosti.

## Sadržaj

- `index.html`, `styles.css`, `app.js` — dostupno sučelje i interakcije
- `docs/data-sources.md` — izvor, geografija, vrijeme, licenca i transformacije
- `docs/architecture.md` — produkcijski put i granice prototipa
- `server.mjs` — vrlo mali lokalni server

## Podaci i povezanost izvora

Pri odabiru grada server dohvaća mali, svježi OpenStreetMap API snimak i povezuje ga s pripremljenim gradskim pokazateljima DZS-a te lokalnim OSM snimkom za neprekinut rad. Tako se u jednome prikazu povezuju prostorni signali pristupa, ponude i aktivnosti s demografskim i sezonskim kontekstom iz različitih javnih izvora. Cjelovit popis API-ja, pripremljenih skupova, licenci, geografskog obuhvata i transformacija nalazi se u [registru izvora](docs/data-sources.md).
