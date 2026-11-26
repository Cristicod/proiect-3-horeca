# ADR 003: Idempotența Comenzilor prin client_request_id

## Status
Acceptat

## Context
Pe conexiunile mobile instabile (Wi-Fi de restaurant, 4G/5G fluctuant), utilizatorii pot trimite comanda de două ori prin tap repetat sau reîncercări automate ale browserului la timeout HTTP.

## Decizie
1. Tabela `orders` include coloana `client_request_id VARCHAR(128)` și constrângerea unică:
   ```sql
   CONSTRAINT uq_session_client_request_id UNIQUE (session_id, client_request_id)
   ```
2. La primirea cererii `POST /api/orders`, dacă există deja o comandă cu același `client_request_id` în aceeași sesiune:
   - Serverul returnează `200 OK` cu payload-ul `{ duplicate: true, orderId: existing.id, state: existing.state }`.
   - Nu se inserează nicio linie nouă în `orders` sau `order_items`.

## Consecințe
Garantează comenzi strict idempotente fără dubluri în bucătărie sau pe nota de plată.

