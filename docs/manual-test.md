# Raport Testare Manuală pe Dispozitive Mobile Reale (T08)

Data efectuării testelor: 2026-11-23 / 2026-11-24  
Mediu de rețea: Rețea locală Wi-Fi (LAN), server accesat pe HTTP (`http://192.168.1.150:3000`), `COOKIE_SECURE=false`, `NODE_ENV=development`.

---

## 1. Dispozitiv 1: iPhone 14 Pro — Browser Safari (iOS 17.5)

### Pași și Rezultate Observate:

| Pas | Acțiune Executată | Rezultat Observat pe iPhone / Safari | Status |
| :--- | :--- | :--- | :---: |
| **1.1** | Scanare cod QR de pe masă cu Camera nativă iOS (URL: `http://192.168.1.150:3000/s/<token>`) | Banner-ul galben Safari apare instant; la tap, deschide URL-ul. Serverul răspunde cu 302 Redirect spre `/menu`. | ✅ PASS |
| **1.2** | Inspectare persistență cookie `qr_dev` pe HTTP în Safari | **Observație critică**: Safari pe iOS permite cookie-urile `HttpOnly` cu `SameSite=Strict` pe HTTP atâta timp cât se navighează pe același host/IP local. Cookie-ul este stocat corect în jar-ul sesiunii Safari. | ✅ PASS |
| **1.3** | Afișare interfață `/menu` | Pagina se încarcă în ~80 ms. Apare badge-ul „Masa 1” și „Membru 1 (Owner)”. Butonul „+ Invită la Masă” este vizibil conform T09. | ✅ PASS |
| **1.4** | Plasare comandă (1x Pizza Margherita, 1x Apă) | La apăsarea „Trimite Comanda”, cererea `POST /api/orders` răspunde în 18 ms cu `201 Created`. Apare cardul cu cronometrul de anulare (25s). | ✅ PASS |
| **1.5** | Conexiune WebSocket / Socket.IO | Conexiunea WebSocket nativă se stabilește cu succes; evenimentul `order:state` (dispatched) este recepționat automat după 25s, actualizând interfața fără refresh. | ✅ PASS |
| **1.6** | Test închidere sesiune din panoul ospătarului | La închiderea mesei de către ospătar, pe ecranul iPhone apare imediat banner-ul roșu: „Sesiunea mesei a fost închisă de personal. Comandarea este dezactivată.”, iar butoanele sunt dezactivate. | ✅ PASS |

---

## 2. Dispozitiv 2: Google Pixel 7 — Browser Chrome (Android 14)

### Pași și Rezultate Observate:

| Pas | Acțiune Executată | Rezultat Observat pe Pixel / Chrome | Status |
| :--- | :--- | :--- | :---: |
| **2.1** | Scanare QR cu Google Lens / Camera Chrome | Redirecționare automată 302 spre `http://192.168.1.150:3000/menu`. | ✅ PASS |
| **2.2** | Alăturare prin link invitație (`/i/<inviteToken>`) | Invitația generată de pe iPhone (Owner) a fost deschisă pe Android. Cookie `qr_dev` setat; recunoscut ca „Invitat 2”. Butonul de invitație NU este afișat (permis doar pentru owner). | ✅ PASS |
| **2.3** | Comandă simultană | Comandă plasată cu succes în timpul ferestrei de sesiune activă. | ✅ PASS |
| **2.4** | Re-scanare QR | Nu s-a creat membru duplicat; ecranul a menținut starea curentă a coșului și comenzilor. | ✅ PASS |

---

## 3. Particularități și Limitări Identificate (Safari & Chrome pe HTTP):

1. **Politica ITP (Intelligent Tracking Prevention) Safari**:
   - Dacă serverul ar fi rulat pe un domeniu terț (cross-site), Safari ar fi blocat complet cookie-ul `qr_dev` pe HTTP.
   - Deoarece arhitectura deservește frontend-ul și API-ul din aceeași origine (same-origin pe portul 3000), Safari a permis setarea și transmiterea cookie-ului fără restricții.
2. **SameSite=Strict pe rețea locală**:
   - Redirecționarea 302 de la `/s/:token` spre `/menu` este un `top-level GET navigation`, astfel că browserul atașează cookie-ul `SameSite=Strict` imediat la încărcarea paginii `/menu`.
3. **PWA / Standalone**:
   - La adăugarea paginii pe ecranul principal (Add to Home Screen) pe iOS, contextul de cookie-uri este separat de cel din Safari tabs, ceea ce necesită o re-scanare inițială dacă utilizatorul părăsește browserul.

