# Registrul Neconcordanțelor Tehnice și Corecțiilor de Specificație (docs/discrepancies.md)

Acest document consemnează discrepanțele identificate între textul inițial al lucrării/fișei de detaliere și realitatea implementării tehnice și a măsurătorilor empirice.

---

### 1. Definiția Metricii de Latență (Ținta de 150 ms)
- **Afirmația din textul inițial**: Ținta de latență este de „< 150 ms până la afișarea pe tableta din bucătărie”.
- **Neconcordanța**: În Varianta A, comanda plasată intră obligatoriu în starea `queued` și este reținută timp de **25 de secunde** (fereastra de anulare/undo). Bucătăria recepționează comanda abia în momentul stării `dispatched` (după 25s). Prin urmare, intervalul POST → afișare bucătărie nu poate fi niciodată sub 150 ms din motive de design intenționat.
- **Corecție aplicată**: Metrica de performanță a sistemului a fost redefinită ca **POST → queued** (confirmarea primirii comenzii în stiva bazei de date și confirmarea pe Socket.IO către client), care măsoară între **5 ms și 52 ms** (p50). Întârzierea dispatch-ului este măsurată separat în baza de date ca `dispatched_at - dispatch_after` (medie sub 120 ms).

---

### 2. „Varianta A implementată integral” și Interfața pentru Invitații
- **Afirmația din textul inițial**: „Varianta A este complet funcțională cap-coadă”.
- **Neconcordanța**: Până la T09, rutele backend pentru invitații (`/api/session/invites` și `/i/:token`) existau în API, dar butonul grafic lipsea din meniul clientului.
- **Corecție aplicată**: S-a dezvoltat butonul „+ Invită la Masă” în `public/menu.html` (activ exclusiv pentru proprietarul mesei) și modalul care expune link-ul generat (T09).

---

### 3. Vocabularul Stărilor Mesei: Business vs. Bază de Date
- **Afirmația din fișă**: Mesele se află în stările `LIBERA`, `OCUPATA`, `INCHISA`.
- **Neconcordanța**: În schema relațională, tabela `tables` este permanentă, iar `table_sessions` folosește `state IN ('active', 'closed')`.
- **Corecție aplicată**: S-a creat vederea relațională `v_table_status`, care reconciliează terminologia:
  - Fără sesiune activă -> `LIBERA`
  - Sesiune activă -> `OCUPATA`
  - Sesiune închisă -> `INCHISA`

---

### 4. Rotația URL-urilor și Ecusonul cu Culoare Derivată (Varianta B)
- **Afirmația din capitol**: Rotația URL-urilor la 6–12 luni și ecusonul fizic colorat.
- **Clarificare**: Aceste elemente aparțin arhitecturii **Variantei B**. Deoarece Varianta B nu are implementată o interfață vizuală, acestea sunt documentate ca arhitectură și specificație de design, fiind validate la nivel de schemă prin testele de stare din `db/verify.mjs` (T00).

---

### 5. Legarea Token-ului de Dispozitiv: Unul vs. Patru Dispozitive
- **Afirmația din textul inițial**: Token-ul este „legat de primul dispozitiv care scanează”.
- **Neconcordanța**: Sesiunea mesei este partajată; primul dispozitiv devine `owner = true`, dar masa acceptă până la **4 dispozitive simultan** (`session_members`, max 4).
- **Corecție aplicată**: Textul capitolului este aliniat cu logica de cod: primul dispozitiv obține rolul de proprietar al sesiunii (cu drepturi de invitație și închidere), iar dispozitivele 2, 3 și 4 se pot alătura fie prin scanarea aceluiași QR, fie prin link de invitație.

