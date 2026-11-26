# ADR 004: Frontend Servit din Același Server Express (Same-Origin)

## Status
Acceptat

## Context
Browserul Safari pe iOS aplică reguli stricte ITP (Intelligent Tracking Prevention) și blochează cookie-urile cross-site sau pe origini terțe, în special pe HTTP în rețele locale.

## Decizie
Frontend-ul static (`public/menu.html`, `public/kitchen.html`, `public/waiter.html`) este servit direct din instanța Express prin middleware-ul `express.static('public')`.

## Consecințe
1. Cookie-ul `qr_dev` cu `SameSite=Strict` și `HttpOnly` funcționează impecabil pe Safari și Chrome mobile pe rețea locală.
2. Nu sunt necesare configurații complexe de reverse proxy sau CORS cross-origin pentru clienți.

