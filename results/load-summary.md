# Raport Comparativ de Performanță și Latență (T05)

**Metodologie**: Măsurat prin cronometrare exactă (high-resolution) de la trimiterea cererii HTTP `POST /api/orders` (sau `POST /baseline/orders`) până la recepționarea evenimentului `order:state` cu starea `queued` pe conexiunea Socket.IO a utilizatorului.

> [!IMPORTANT]
> **Definiția metricii de latență**: Latența directă a sistemului măsoară intervalul **POST → queued** (confirmarea primirii comenzii în stivă și broadcast-ul pe socket). Comanda ajunge fizic în bucătărie abia după expirarea ferestrei de anulare de **25 secunde** (starea `dispatched`). Întârzierea dispatch-ului este determinată de această fereastră de securitate intenționată (`dispatched_at - dispatch_after`), nu de latența rețelei sau a serverului.

### Tabel Comparativ: Modul Securizat (Varianta A) vs. QR Static (Baseline)

| Mod de Rulare | Utilizatori Virtuali (VUs) | Mediana p50 (ms) | Percentila p95 (ms) | Percentila p99 (ms) | Rată Erori (%) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **SECURED** | 10 | 50.62 ms | 61.05 ms | 61.05 ms | 0% |
| **SECURED** | 50 | 9.53 ms | 12.08 ms | 13.88 ms | 0% |
| **SECURED** | 100 | 8.96 ms | 12.63 ms | 14.15 ms | 0% |
| **BASELINE** | 10 | 5.94 ms | 7.25 ms | 7.25 ms | 0% |
| **BASELINE** | 50 | 5.65 ms | 8.78 ms | 9.14 ms | 0% |
| **BASELINE** | 100 | 5.62 ms | 9.16 ms | 9.77 ms | 0% |

### Analiza Overhead-ului de Securitate:
- **Overhead criptografic și validare sesiune**: Modul securizat introduce o verificare a cookie-ului HttpOnly (`qr_dev`), interogarea sesiunii active și validarea constrângerilor de membru.
- **Comparație p50**: La 100 de utilizatori concurenți, overhead-ul securității adaugă doar câțiva milisecunde peste baseline-ul static, menținând latența complet sub ținta operațională.
- **Stabilitate Socket.IO**: Izolarea pe camere Socket.IO (`table:<id>`) asigură livrarea instantanee a confirmării fără difuzare globală nenecesară.
