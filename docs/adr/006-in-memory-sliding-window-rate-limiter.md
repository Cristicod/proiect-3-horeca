# ADR 006: Limitator de Rată în Memorie cu Sliding Window și Freeze Dispozitiv

## Status
Acceptat

## Context
Protecția endpoint-urilor critice (`/api/orders`, `/api/calls`, `/api/staff/login`) împotriva atacurilor de tip brute-force și Denial of Service la nivel de masă.

## Decizie
1. Implementare în memorie cu algoritm sliding-window (fără dependențe grele externe precum Redis pentru prototip).
2. Praguri aplicate:
   - Login personal: max 20 încercări greșite în 15 minute -> `429 Too Many Requests`.
   - Comenzi: max 10 pe minut per dispozitiv.
   - Apeluri ospătar: max 6 pe minut per dispozitiv.
3. Înghețare dispozitiv (T07): Dacă un dispozitiv depășește limita de rată de 3 ori în 5 minute, membrul respectiv este înghețat (`frozen_until = now() + 10 min`). Înghețarea se aplică strict pe `member_id` / `device_token`, NICIODATĂ pe IP (deoarece toți clienții din restaurant partajează același IP extern de Wi-Fi).

## Consecințe
Protejează restaurantul de atacuri fără a penaliza ceilalți clienți conectați la rețeaua locală.

