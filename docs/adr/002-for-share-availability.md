# ADR 002: Verificarea Disponibilității Produselor cu Clauza FOR SHARE

## Status
Acceptat

## Context
În momentul plasării unei comenzi de către un client (`POST /api/orders`), produsele din meniu trebuie să fie disponibile (`available = true`). În scenarii de concurență ridicată (mai mulți clienți la mese diferite comandând ultimul produs din stoc), verificarea naivă poate duce la comenzi plasate pe produse tocmai epuizate.

## Decizie
Validarea disponibilității produselor din meniu se face tranzacțional, interogând tabela `menu_items`. Dacă oricare produs are `available = false`, cererea este respinsă imediat cu `409 Conflict` (cod `item_unavailable`), garantând că exact zero rânduri sunt inserate în `orders` și `order_items`.

## Consecințe
Se previn discrepanțele din bucătărie și comenzile fantomă.

