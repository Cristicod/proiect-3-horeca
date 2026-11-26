# Matrice de Trasabilitate a Cerințelor și Afirmațiilor Tehnice (docs/traceability.md)

Matricea face legătura între fiecare afirmație din textul lucrării/fișei de detaliere și artefactul software care o verifică (test automat, script de atac sau harness).

| ID Cerință / Afirmație | Text Afirmație din Fișă / Capitol | Test ID / Script Verificare | Status Conformitate |
| :--- | :--- | :--- | :---: |
| **STATE-B1** | Varianta B: Ecuson unic per masă pe durata stării de candidat; eliberare la activare | `db/verify.mjs` (T00-1, T00-2) | ✅ Verificat |
| **STATE-B2** | Varianta B: Expirare candidați stătăuți prin funcție dedicată | `db/verify.mjs` (T00-3) | ✅ Verificat |
| **STATE-B3** | Varianta B: Respingere comenzi pe sesiune candidat închisă | `db/verify.mjs` (T00-4) | ✅ Verificat |
| **STATE-B4** | Varianta B: Plafon max 3 candidați activi per masă, ignorând cei expirați | `db/verify.mjs` (T00-5) | ✅ Verificat |
| **SMOKE-E2E** | Sistemul pornește și rulează fluxul complet cap-coadă pe PostgreSQL | `scripts/smoke.mjs` (T01) | ✅ Verificat |
| **SCAN-01** | Scanare token valid: 302 spre `/menu`, Set-Cookie `qr_dev` cu HttpOnly și SameSite=Strict | `tests/http.test.mjs` (SCAN-01) | ✅ Verificat |
| **SCAN-02** | Scanare token cu format eronat: 404 | `tests/http.test.mjs` (SCAN-02) | ✅ Verificat |
| **SCAN-03** | Scanare token al unei sesiuni închise sau expirate: 404 | `tests/http.test.mjs` (SCAN-03) | ✅ Verificat |
| **SCAN-04** | Același dispozitiv scanează din nou: nu se creează membru nou în sesiune | `tests/http.test.mjs` (SCAN-04) | ✅ Verificat |
| **SCAN-05** | Al cincilea dispozitiv care încearcă să intre la masă este respins cu 403 | `tests/http.test.mjs` (SCAN-05) | ✅ Verificat |
| **SCAN-06** | Două scanări simultane ale primei sesiuni desemnează exact un singur owner | `tests/http.test.mjs` (SCAN-06) | ✅ Verificat |
| **INV-01** | Owner-ul mesei creează invitație cu link unic; invitatul primește cookie și redirect | `tests/http.test.mjs` (INV-01) | ✅ Verificat |
| **INV-02** | A doua utilizare a aceluiași token de invitație: 404 | `tests/http.test.mjs` (INV-02) | ✅ Verificat |
| **INV-03** | Oaspete (non-owner) care încearcă să creeze invitație primește 403 `owner_only` | `tests/http.test.mjs` (INV-03) | ✅ Verificat |
| **INV-04** | Plafon atins de 3 invitații active concurente: 409 `invite_cap_reached` | `tests/http.test.mjs` (INV-04) | ✅ Verificat |
| **INV-05** | Invitație expirată temporal: 404 | `tests/http.test.mjs` (INV-05) | ✅ Verificat |
| **ORD-01** | Comandă validă returnează 201, stare `queued` și timestamp `dispatchAfter` (+25s) | `tests/http.test.mjs` (ORD-01) | ✅ Verificat |
| **ORD-02** | Idempotență: același `clientRequestId` returnează `duplicate: true`, un singur rând DB | `tests/http.test.mjs` (ORD-02) | ✅ Verificat |
| **ORD-03** | Produs indisponibil: 409 `item_unavailable`, zero inserări în orders/order_items | `tests/http.test.mjs` (ORD-03) | ✅ Verificat |
| **ORD-04** | Anulare comandă în fereastra de 25 secunde: 200, stare `cancelled` | `tests/http.test.mjs` (ORD-04) | ✅ Verificat |
| **ORD-05** | Anulare după expirarea ferestrei de 25s: 409 `undo_window_closed` | `tests/http.test.mjs` (ORD-05) | ✅ Verificat |
| **ORD-06** | Membru care încearcă să anuleze comanda altui membru primește 409 | `tests/http.test.mjs` (ORD-06) | ✅ Verificat |
| **ORD-07** | Validare cantități: 0, >20 sau >30 linii distincte returnează 400 Bad Request | `tests/http.test.mjs` (ORD-07) | ✅ Verificat |
| **ORD-08** | Comandă fără cookie de sesiune `qr_dev`: 401 Unauthorized | `tests/http.test.mjs` (ORD-08) | ✅ Verificat |
| **ORD-09** | Înghețare dispozitiv abuziv pe comenzi: membru înghețat (403), colegul de masă funcțional | `tests/http.test.mjs` (ORD-09) | ✅ Verificat |
| **CALL-01** | Apel ospătar valid: 201 Created | `tests/http.test.mjs` (CALL-01) | ✅ Verificat |
| **CALL-02** | Al patrulea apel deschis nesoluționat: 409 `call_cap_reached` | `tests/http.test.mjs` (CALL-02) | ✅ Verificat |
| **CALL-03** | Rata de apeluri depășită (>6/minut): 429 Too Many Requests | `tests/http.test.mjs` (CALL-03) | ✅ Verificat |
| **CALL-04** | Înghețare dispozitiv abuziv pe apeluri repetate: 403 `device_frozen` | `tests/http.test.mjs` (CALL-04) | ✅ Verificat |
| **STF-01** | Acces rute personal fără antet Authorization: 401 | `tests/http.test.mjs` (STF-01) | ✅ Verificat |
| **STF-02** | Personal bucătărie care încearcă deschiderea unei mese: 403 Forbidden | `tests/http.test.mjs` (STF-02) | ✅ Verificat |
| **STF-03** | Ospătar care încearcă trecerea comenzii în `preparing`: 403 `forbidden_transition` | `tests/http.test.mjs` (STF-03) | ✅ Verificat |
| **STF-04** | Bucătar care încearcă marcarea ca `served`: 403 `forbidden_transition` | `tests/http.test.mjs` (STF-04) | ✅ Verificat |
| **STF-05** | Tranziție ilegală de stare (dispatched direct la ready): 409 | `tests/http.test.mjs` (STF-05) | ✅ Verificat |
| **STF-06** | Deschiderea unei mese care are deja sesiune activă: 409 `table_already_open` | `tests/http.test.mjs` (STF-06) | ✅ Verificat |
| **STF-07** | Parolă greșită: 401. Peste 20 încercări în 15 min: 429 | `tests/http.test.mjs` (STF-07) | ✅ Verificat |
| **SESS-01** | Sesiune expirată în DB accesată cu cookie vechi: 401 | `tests/http.test.mjs` (SESS-01) | ✅ Verificat |
| **CFG-01** | Producție cu `COOKIE_SECURE=false`: procesul refuză pornirea | `tests/http.test.mjs` (CFG-01) | ✅ Verificat |
| **CFG-02** | Producție cu `BASELINE_MODE=true`: procesul refuză pornirea | `tests/http.test.mjs` (CFG-02) | ✅ Verificat |
| **SOCK-01** | Socket.IO fără cookie și fără token: `not_authenticated` | `tests/socket.test.mjs` (SOCK-01) | ✅ Verificat |
| **SOCK-02** | Socket.IO cu Origin străin la handshake: `origin_not_allowed` | `tests/socket.test.mjs` (SOCK-02) | ✅ Verificat |
| **SOCK-03** | Socket.IO same-origin fără Origin explicit: conectare cu succes | `tests/socket.test.mjs` (SOCK-03) | ✅ Verificat |
| **SOCK-04** | Clientul mesei primește `order:state` queued imediat după POST | `tests/socket.test.mjs` (SOCK-04) | ✅ Verificat |
| **SOCK-05** | Bucătăria primește automat `dispatched` de la background worker | `tests/socket.test.mjs` (SOCK-05) | ✅ Verificat |
| **SOCK-06** | Socket.IO cu JWT invalid: `not_authenticated` | `tests/socket.test.mjs` (SOCK-06) | ✅ Verificat |
| **SOCK-07** | Izolare pe camere: Masa 2 NU recepționează evenimentele Mesei 1 | `tests/socket.test.mjs` (SOCK-07) | ✅ Verificat |
| **ATK-A1** | Replay QR fotografiat înainte de deschidere: 0/50 acceptate | `scripts/attacks/run-all.mjs` (A1) | ✅ Verificat |
| **ATK-A2** | QR activ folosit de dispozitive străine: exact 4 acceptate (plafon) | `scripts/attacks/run-all.mjs` (A2) | ✅ Verificat |
| **ATK-A3** | Comandă după închiderea sesiunii de către personal: 0/50 acceptate | `scripts/attacks/run-all.mjs` (A3) | ✅ Verificat |
| **ATK-A4** | Falsificare token (1 bit modificat / ghicire): 0/50 acceptate | `scripts/attacks/run-all.mjs` (A4) | ✅ Verificat |
| **ATK-A5** | Rafală de comenzi de pe un singur dispozitiv: limitat la prag | `scripts/attacks/run-all.mjs` (A5) | ✅ Verificat |
| **LOAD-T05** | Latență POST → queued sub 150ms pentru 10, 50, 100 VUs vs. Baseline | `load/run.mjs` | ✅ Verificat |
| **SIM-T06** | Simulare eficiență operațională (20 mese, flux tradițional vs digital) | `scripts/sim/service.mjs` | ✅ Verificat |
| **ROT-URL** | Rotație URL la 6-12 luni și ecuson colorat derivat (Varianta B) | `docs/discrepancies.md` (Secț. 4) | ⚠️ Limită (Design) |

