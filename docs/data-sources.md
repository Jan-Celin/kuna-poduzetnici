# Registar izvora podataka

Zadnje uređivanje: 9. 11. 2026. Rješenje povezuje živi OpenStreetMap API dohvat s pripremljenim gradskim pokazateljima iz službenih otvorenih izvora i lokalnim kartografskim snimkom za neprekinut rad. Pripremljeni zapisi čuvaju reproducibilnost demonstracije; svaki red ispod navodi izdavatelja, resurs, geografiju, vrijeme, licencu i primijenjenu transformaciju.

| ID | Skup podataka i izdavatelj | Katalog data.gov.hr | Izravni resurs / polazište | Geografija i vrijeme | Licenca / uvjeti | Transformacija u prototipu | Zadnja uspješna provjera |
|---|---|---|---|---|---|---|---|
| DZS-POP | Popis stanovništva 2021. — Državni zavod za statistiku | https://data.gov.hr/ckan/hr/dataset/stanovni-tvo | https://podaci.dzs.hr/media/ixpn5qzo/si-1711-popis-stanovnistva-kucanstava-i-stanova-2021-prvi-rezultati-po-naseljima.pdf | Gradovi/općine; Popis 2021. | Uvjeti korištenja DZS i otvoreni katalog | Pripremljeni gradski zapisi za Zadar, Rovinj, Karlovac i Osijek daju stalnu demografsku bazu; ne pripisuju se mikrolokaciji ni prihodovnoj potražnji. | Provjereno: 9. 11. 2026. |
| DZS-TOUR | Dolasci i noćenja turista — Državni zavod za statistiku | https://data.gov.hr/ | https://podaci.dzs.hr/hr/podaci/turizam/dolasci-i-nocenja-turista/ | Gradovi i općine kada su objavljeni; u sučelju je pripremljeni sezonski omjer | Uvjeti korištenja DZS i otvoreni katalog | Pripremljeni sezonski kontekst služi za usporedbu ljetnog i zimskog opterećenja; nije mikro-lokacijska procjena potražnje ni prihodovna prognoza. | Polazište provjereno: 9. 11. 2026. |
| DZS-BUS | Strukturne poslovne statistike — DZS | https://data.gov.hr/ckan/hr/dataset/strukturne-poslovne-statistike | https://web.dzs.hr/PXWeb/ | RH / NKD kada je objavljeno; 2023.–2024. | Uvjeti korištenja DZS i otvoreni katalog | Nacionalni sektor trend nije lokalni rezultat | Katalog: 8. 11. 2026. |
| HC-TRAFFIC | Brojenje prometa — Hrvatske ceste | https://data.gov.hr/ | https://hrvatske-ceste.hr/hr/poslovni-segmenti/promet/brojanje-prometa | Mjerno mjesto ili cestovni odsjek; 2024. | Uvjeti korištenja izdavatelja | Samo kvalitativni demonstracijski signal; produkcija zapisuje odsjek, AADT i datum | Polazište zapisano: 8. 11. 2026. |
| DGU-ADMIN | Upravne jedinice INSPIRE — Državna geodetska uprava | https://data.gov.hr/ckan/hr/dataset/upravne-jedinice-inspire | https://geoportal.dgu.hr/services/inspire/wms | RH; upravne jedinice prema objavi | Otvoreni prostorni podaci DGU | Produkcija: granice i prostorno povezivanje. Prototip: lokalno spremljene OpenStreetMap kartografske pločice i označene koordinate oglednih područja; dohvat je procjena, nije izračun stvarnog vremena putovanja | Katalog: 8. 11. 2026. |
| HBOR | Financijski proizvodi i programi — HBOR | https://data.gov.hr/ | https://www.hbor.hr/nasi-proizvodi/ | RH; stanje treba provjeriti pri korištenju | Javno objavljene informacije HBOR-a | Poveznice za sljedeće korake, bez procjene podobnosti ili obećanja odobrenja | Polazište zapisano: 8. 11. 2026. |
| START | Pokretanje poslovanja — državna usluga START | — | https://start.gov.hr/st/index.html | RH; postupak ovisi o pravnom obliku i okolnostima osnivača | Uvjeti državne usluge | Prototip daje samo usmjerenje prema službenom postupku i jasno ne daje pravno ili porezno tumačenje. | Polazište provjereno: 9. 11. 2026. |
| OSM-SIGNALS | OpenStreetMap kartografski zapisi | https://www.openstreetmap.org/ | https://api.openstreetmap.org/api/0.6/map | Mali živi prozor oko odabranog središta Zadra, Rovinja, Karlovca ili Osijeka; lokalna pričuva pokriva širu oglednu zonu | ODbL, uz atribuciju OpenStreetMap contributors | Server-side adapter dohvati mali API snimak pri odabiru grada, normalizira samo ugostiteljske objekte, parkirališta, stajališta i točke aktivnosti te ga nadopunjuje uz ugrađenu offline pričuvu. Odgovor je u memoriji cacheiran 30 minuta. Pokrivenost ovisi o mapiranju zajednice i nije potpun popis poslovanja. | Živi odgovor: vrijeme je u API odgovoru; pričuva: 9. 11. 2026. |
| OSM-ROADS | OpenStreetMap geometrija cesta i anonimni obrisi zgrada | https://www.openstreetmap.org/ | https://api.openstreetmap.org/api/0.6/map | Središnja gradska zona za Zadar, Rovinj, Karlovac i Osijek; lokalni snimak | ODbL, uz atribuciju OpenStreetMap contributors | Prototip zadržava geometriju ulica, cesta i obrisa zgrada potrebnu za čitanje pristupa i urbanog tkiva. Adrese, kućni brojevi, oznake prometnica, granice i pokrov tla namjerno se ne prikazuju. | Snimak: 9. 11. 2026. |
| BRAND-MARTEN | Silueta kune (Martes foina) — Ferran Sayol / PhyloPic | — | https://www.phylopic.org/images/7f7431c6-8f78-498b-92e2-ebf8882a8923/martes-foina | Nije podatkovni sloj | CC0 1.0 | Lokalno spremljena SVG ikona za zaglavlje i favicon. | Preuzeto: 9. 11. 2026. |

## Plan adaptera za produkcijsku verziju

Svaki adapter čuva izvorni odgovor, URL resursa, datum i vrijeme preuzimanja, kontrolnu sumu, licencu, geografsku razinu i transformaciju. Normalizirani pokazatelj ne smije biti prikazan ako nema `sourceId`, `period`, `geography`, `freshness` i `confidence`. Neuspjeh adaptera mora se prikazati kao stanje nedostupnog izvora, a ne zamijeniti zadanim zaključkom.

## AI pomoćnik

Slobodno pitanje u KUNA AI ne čita skrivene podatke niti pretražuje internet. Server mu šalje samo strukturirani kontekst koji je već prikazan korisniku: odabrani grad, profil i opis ideje, stanovništvo i sezonalnost, agregirane OSM signale te njihove izvore. Zadana integracija je lokalna Ollama (`qwen2.5:3b`), pa pitanje ostaje na računalu i nema troška API poziva. OpenAI Responses API je opcionalan adapter koji se uključuje samo varijablom `AI_PROVIDER=openai` i ključ ostaje na serveru. Pomoćnik mora izraziti nepoznanice i ne daje pravni, porezni ili investicijski savjet.

## Važna ograničenja

- Katalog-zapis nije zamjena za provjeru aktualnog izravnog resursa i njegove licence prije objave produkcijskih brojki.
- Mjesečni turizam ne opisuje konkretan poslovni prostor ni ponašanje pojedinog kupca.
- Cestovni promet nije isto što i dostupna kupovna potražnja.
- Javne statistike različite geografske razine ne uspoređuju se kao da imaju istu preciznost.
