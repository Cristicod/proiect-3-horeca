# ADR 001: Schema PostgreSQL Consolidată și Modelul Unic de Sesiune

## Status
Acceptat

## Context
Aplicația necesită gestionarea stării meselor și a accesului clienților. În specificația inițială existau ambiguități între stările fizice ale mesei (`LIBERA`, `OCUPATA`, `INCHISA`) și starea ciclului de viață a sesiunii software (`active`, `closed`).

## Decizie
1. Tabelele principale `tables` și `table_sessions` sunt separate.
2. În `table_sessions`, starea este fie `active`, fie `closed`.
3. S-a introdus un index parțial unic:
   ```sql
   CREATE UNIQUE INDEX idx_one_active_session_per_table ON table_sessions(table_id) WHERE state = 'active';
   ```
   Acesta garantează la nivel de motor relațional imposibilitatea existenței a două sesiuni active simultane pe aceeași masă.
4. S-a creat vederea relațională `v_table_status`, care mapează automat starea către vocabularul de business:
   - Sesiune lipsă -> `LIBERA`
   - Sesiune cu `state = 'active'` -> `OCUPATA`
   - Sesiune marcată ca `state = 'closed'` -> `INCHISA`

## Consecințe
Integritatea tranzacțională este garantată la nivel de bază de date, eliminând race conditions la deschiderea meselor.

