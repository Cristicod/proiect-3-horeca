# ADR 005: Politica de Validare Origin la Handshake Socket.IO

## Status
Acceptat

## Context
Socket.IO este vulnerabil la atacuri Cross-Site WebSocket Hijacking dacă antetul `Origin` nu este restricționat la nivel de handshake.

## Decizie
La inițierea handshake-ului Socket.IO:
1. Dacă antetul `Origin` este prezent:
   - Se validează că originea corespunde cu `APP_URL` (sau hostname-ul local).
   - Dacă originea este străină (ex: `http://malicious-attacker.com`), handshake-ul este respins imediat cu eroarea `origin_not_allowed`.
2. Dacă antetul `Origin` lipsește (clienți server-to-server, clienți de test, same-origin polling nativ), conexiunea este permisă sub rezerva autentificării cu cookie `qr_dev` sau token JWT de personal.

## Consecințe
Previne exploatarea conexiunilor în timp real de către scripturi găzduite pe domenii terțe.

