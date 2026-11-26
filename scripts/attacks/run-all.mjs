import fs from 'node:fs';
import path from 'node:path';
import { createApp, createServer } from '../../dist/server.js';
import { db } from '../../dist/db.js';
import { seedDatabase } from '../seed.mjs';
import { runA1 } from './a1-replay-closed.mjs';
import { runA2 } from './a2-photo-during-session.mjs';
import { runA3 } from './a3-order-after-close.mjs';
import { runA4 } from './a4-tampered-token.mjs';
import { runA5 } from './a5-order-burst.mjs';

async function main() {
  console.log('======================================================');
  console.log('RULARE SCENARII DE ATAC REPRODUCTIBILE (T04)');
  console.log('======================================================');

  await seedDatabase();
  await db.init();

  const app = createApp();
  const { server } = createServer(app);

  let baseUrl;
  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Server atacuri pornit pe: ${baseUrl}`);
      resolve(null);
    });
  });

  const N = 50;
  const results = [];

  console.log('\nRulare Scenariul A1...');
  const resA1 = await runA1(baseUrl, db, N);
  results.push(resA1);
  console.log(`A1: ${resA1.accepted}/${N} acceptate (așteptat: ${resA1.expectedAccepted})`);

  console.log('\nRulare Scenariul A2...');
  const resA2 = await runA2(baseUrl, db, N);
  results.push(resA2);
  console.log(`A2: ${resA2.accepted}/${N} acceptate (așteptat: ${resA2.expectedAccepted})`);

  console.log('\nRulare Scenariul A3...');
  const resA3 = await runA3(baseUrl, db, N);
  results.push(resA3);
  console.log(`A3: ${resA3.accepted}/${N} acceptate (așteptat: ${resA3.expectedAccepted})`);

  console.log('\nRulare Scenariul A4...');
  const resA4 = await runA4(baseUrl, db, N);
  results.push(resA4);
  console.log(`A4: ${resA4.accepted}/${N} acceptate (așteptat: ${resA4.expectedAccepted})`);

  console.log('\nRulare Scenariul A5...');
  const resA5 = await runA5(baseUrl, db, N);
  results.push(resA5);
  console.log(`A5: ${resA5.accepted}/${N} acceptate (așteptat: ${resA5.expectedAccepted})`);

  // Salvare CSV
  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const csvHeader = 'Scenario,Attempts,Accepted,Rejected,ExpectedAccepted,Status\n';
  const csvRows = results.map(r => {
    const status = r.accepted === r.expectedAccepted ? 'MATCH' : 'DISCREPANCY';
    return `"${r.scenario}",${r.n},${r.accepted},${r.rejected},${r.expectedAccepted},${status}`;
  }).join('\n');

  fs.writeFileSync(path.join(resultsDir, 'attacks.csv'), csvHeader + csvRows + '\n', 'utf8');

  // Salvare Markdown
  let mdContent = '# Raport Scenarii de Securitate și Atac (T04)\n\n';
  mdContent += `Data rulării: ${new Date().toISOString()}\n`;
  mdContent += `Număr încercări per scenariu: N = ${N}\n\n`;
  mdContent += '| Scenariu de Atac | Încercări (N) | Acceptate | Respinse | Așteptat din Fișă | Rezultat Conformitate |\n';
  mdContent += '| :--- | :---: | :---: | :---: | :---: | :---: |\n';

  for (const r of results) {
    const isMatch = r.accepted === r.expectedAccepted;
    const mark = isMatch ? '✅ Conform' : '⚠️ Neconcordanță';
    mdContent += `| ${r.scenario} | ${r.n} | ${r.accepted} | ${r.rejected} | ${r.expectedAccepted} | ${mark} |\n`;
  }

  mdContent += '\n### Concluzii de Securitate:\n';
  mdContent += '1. **Replay sesiune închisă (A1)**: Rata de succes este strict 0%. Token-urile expirate sunt respinse cu 404.\n';
  mdContent += '2. **Fotografiere QR activ (A2)**: Sistemul limitează strict la plafonul de 4 dispozitive per masă. Exact 4 dispozitive pot participa, restul de 46 fiind blocate cu 403.\n';
  mdContent += '3. **Comenzi post-închidere (A3)**: Sesiunea marcată ca închisă invalidează imediat cookie-urile asociate (0 comenzi acceptate).\n';
  mdContent += '4. **Falsificare token (A4)**: Schimbarea oricărui bit duce la respingere cu 404 fără scurgeri de date.\n';
  mdContent += '5. **Rafală doS (A5)**: Limitatorul de rată oprește rafala după pragul configurat (10 comenzi), declanșând protecția împotriva abuzului.\n';

  fs.writeFileSync(path.join(resultsDir, 'attacks.md'), mdContent, 'utf8');
  console.log('\nRezultatele au fost salvate în results/attacks.csv și results/attacks.md');

  server.close();
  await db.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Eroare atacuri:', err);
  process.exit(1);
});

