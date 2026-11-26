# Platformă Web Real-Time pentru Eficientizarea Fluxului HoReCa prin Meniuri QR Securizate

Proiect de cercetare și implementare completă a prototipului de comandă prin QR dinamic securizat (**Varianta A**) și validare prin teste de stare pentru **Varianta B**.

---

## 🚀 Arhitectură și Tehnologii

- **Backend**: Node.js v20+ / Express 5 + TypeScript
- **Bază de Date**: PostgreSQL 14+ / PGlite WASM (compatibilitate completă cu motorul relațional)
- **Comunicare în Timp Real**: Socket.IO 4.8+ cu autentificare la handshake și izolare pe camere per masă (`table:<id>`)
- **Frontend**: Meniu client responsive (`public/menu.html`), Afișaj bucătărie KDS (`public/kitchen.html`), Panou ospătar (`public/waiter.html`)
- **Securitate**: Cookie `HttpOnly` cu `SameSite=Strict`, plafon de 4 dispozitive/masă, idempotență comenzi (`client_request_id`), verificare disponibilitate tranzacțională, protecție împotriva atacurilor de tip replay.

---

## 🛠️ Comenzi de Rulare Rapide

### 1. Instalare dependențe și compilare TypeScript
```bash
npm install
npm run build
```

### 2. Verificare schemă bază de date (Varianta A + Teste de Stare Varianta B - T00)
```bash
npm run db:verify
```
*Trece toate cele 21 de teste de stare, iar rezultatul este salvat în `results/db-verify.txt`.*

### 3. Populare date demonstrative (Seed)
```bash
npm run db:seed
```
*Creează restaurantul, 3 mese, meniul complet și utilizatorii demo:*
- **Ospătar**: `ospatar@demo.ro` / `parola123`
- **Bucătar**: `bucatar@demo.ro` / `parola123`
- **Manager**: `admin@demo.ro` / `parola123`

### 4. Rulare Smoke Test End-to-End (T01)
```bash
npm run smoke
```
*Verifică întregul ciclu de viață de la deschiderea mesei de către ospătar, scanare QR, comandă, trecere automată la `dispatched` după 25s, flux bucătărie și închidere sesiune. Rezultatele sunt salvate în `results/smoke.log`.*

### 5. Rulare Suită Completă de Teste HTTP și Socket.IO (T02 + T03 + T07)
```bash
npm test
```
*Execută cele 40 de teste de integrare cu ID-uri standardizate (SCAN-01..06, INV-01..05, ORD-01..09, CALL-01..04, STF-01..07, SESS-01, CFG-01..02, SOCK-01..07). Rezultatele sunt exportate în `results/http-tests.txt` și `results/socket-tests.txt`.*

### 6. Rulare Scenarii de Atac Reproductibile (T04)
```bash
npm run attacks
```
*Rulează cele 5 scenarii de atac descrise în lucrare (N=50 încercări fiecare):*
- **A1**: Replay QR sesiune închisă (0/50 acceptate)
- **A2**: QR activ utilizat de dispozitive străine (exact 4 acceptate, restul 46 blocate cu 403)
- **A3**: Comandă după închiderea sesiunii de către personal (0/50 acceptate)
- **A4**: Falsificare token prin modificare de bit (0/50 acceptate)
- **A5**: Rafală de comenzi de pe un singur dispozitiv (limitat la pragul de 10)
*Rezultatele sunt salvate în `results/attacks.csv` și `results/attacks.md`.*

### 7. Rulare Harness de Latență și Comparație cu QR Static (T05)
```bash
npm run load
```
*Execută harness-ul de performanță pentru 10, 50 și 100 de utilizatori virtuali în ambele moduri (`secured` vs `baseline`). Raportul comparativ este salvat în `results/load-summary.md`.*

### 8. Rulare Simulare a Eficienței Operaționale (T06)
```bash
node scripts/sim/service.mjs
```
*Generează comparația algoritmică pentru 20 de mese între fluxul pe hârtie și platforma digitală în `results/sim-results.md`.*

### 9. Pornire Server Dezvoltare
```bash
npm run dev
# sau
npm start
```
Accesați în browser:
- Meniu Client: `http://localhost:3000/menu`
- Panou Bucătărie KDS: `http://localhost:3000/kitchen`
- Panou Ospătar: `http://localhost:3000/waiter`

---

## 📂 Structura Artefactelor și Documentației

- `db/schema.sql`: Schema completă PostgreSQL (Varianta A + tabele de stare Varianta B).
- `docs/adr/`: Deciziile de arhitectură luate (ADR 001 - ADR 006).
- `docs/discrepancies.md`: Analiza neconcordanțelor și clarificarea metricilor (inclusiv redefinirea latenței POST → queued față de fereastra de 25s de anulare).
- `docs/traceability.md`: Matricea de trasabilitate cerințe-teste.
- `docs/manual-test.md`: Raportul de testare manuală pe iPhone (Safari) și Android (Chrome) în rețea locală.
- `results/`: Toate fișierele empirice de rezultate generate de scripturi (`db-verify.txt`, `smoke.log`, `http-tests.txt`, `socket-tests.txt`, `attacks.csv`, `attacks.md`, `load-*.json`, `load-summary.md`, `sim-results.md`, `pg-version.txt`).

