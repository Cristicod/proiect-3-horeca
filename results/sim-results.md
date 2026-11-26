# Simulare a Eficienței Operaționale (T06)

> [!NOTE]
> **Etichetă obligatorie**: Această analiză este o SIMULARE algoritmică bazată pe parametri presupuși. În lipsa unui restaurant partener, nu s-au efectuat măsurători fizice ale timpilor de servire.

### Parametri de simulare utilizați (`results/sim-params.json`)
- **Mese active**: 20 mese (3 persoane/masă).
- **Comenzi per masă**: 2 runde.
- **Timp deplasare și notare tradițională**: 45s deplasare + 60s notare + 45s drum spre bucătărie.
- **Flux digital**: Transmitere instantă + 25s fereastră anulare.

### Rezultate Comparative ale Simulării:

| Indicator Operațional | Flux Tradițional (Hârtie) | Platformă QR Securizată | Variație Similată |
| :--- | :---: | :---: | :---: |
| **Timp transmitere comandă în bucătărie** | 180 secunde | 30.1 secunde | **-83.3%** |
| **Timp total alocat de ospătari (20 mese)** | 2.17 ore | 0.5 ore | **-76.9%** |

### Observații:
1. Fereastra de 25s de anulare protejează bucătăria împotriva greșelilor fără a penaliza fluxul față de notarea pe hârtie (care dura ~180 secunde).
2. Personalul de servire își poate redirecționa atenția către ospitalitate și debarasare în loc de sarcini clericale de preluare comenzi.
