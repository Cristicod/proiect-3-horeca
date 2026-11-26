# Raport Scenarii de Securitate și Atac (T04)

Data rulării: 2026-11-23T17:04:33.592Z
Număr încercări per scenariu: N = 50

| Scenariu de Atac | Încercări (N) | Acceptate | Respinse | Așteptat din Fișă | Rezultat Conformitate |
| :--- | :---: | :---: | :---: | :---: | :---: |
| A1: QR fotografiat înainte de deschidere (sesiune închisă) | 50 | 0 | 50 | 0 | ✅ Conform |
| A2: QR fotografiat în timpul sesiunii (dispozitive străine) | 50 | 4 | 46 | 4 | ✅ Conform |
| A3: Comandă după închiderea sesiunii | 50 | 0 | 50 | 0 | ✅ Conform |
| A4: Token ghicit sau modificat (un bit schimbat) | 50 | 0 | 50 | 0 | ✅ Conform |
| A5: Rafală de comenzi de pe un singur dispozitiv | 50 | 10 | 40 | 10 | ✅ Conform |

### Concluzii de Securitate:
1. **Replay sesiune închisă (A1)**: Rata de succes este strict 0%. Token-urile expirate sunt respinse cu 404.
2. **Fotografiere QR activ (A2)**: Sistemul limitează strict la plafonul de 4 dispozitive per masă. Exact 4 dispozitive pot participa, restul de 46 fiind blocate cu 403.
3. **Comenzi post-închidere (A3)**: Sesiunea marcată ca închisă invalidează imediat cookie-urile asociate (0 comenzi acceptate).
4. **Falsificare token (A4)**: Schimbarea oricărui bit duce la respingere cu 404 fără scurgeri de date.
5. **Rafală doS (A5)**: Limitatorul de rată oprește rafala după pragul configurat (10 comenzi), declanșând protecția împotriva abuzului.
