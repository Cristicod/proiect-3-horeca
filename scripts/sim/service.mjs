import fs from 'node:fs';
import path from 'node:path';

// Parametrii simulării - Documentați ca PRESUPUNERI, nu măsurători fizice
const SIMULATION_PARAMS = {
  assumptions_label: "SIMULARE (Fără măsurători fizice în restaurant partener)",
  tables_count: 20,
  average_party_size: 3, // persoane per masă
  orders_per_table: 2,   // runde de comandă (băuturi/aperitiv + fel principal/desert)
  traditional_workflow: {
    waiter_walk_to_table_sec: 45,
    customer_menu_reading_with_waiter_sec: 120,
    waiter_write_paper_sec: 60,
    waiter_walk_to_kitchen_sec: 45,
    kitchen_ticket_input_sec: 30,
    waiter_bill_delivery_sec: 90
  },
  qr_secured_workflow: {
    customer_qr_scan_sec: 5,
    customer_menu_browse_independent_sec: 0, // nu blochează timpul ospătarului
    order_digital_transmission_sec: 0.1,    // latență transmisiune digitală
    cancellation_window_sec: 25,            // fereastră undo
    waiter_notification_to_kitchen_sec: 0,  // automat via Socket.IO
    digital_bill_request_sec: 10
  }
};

export function runSimulation() {
  const p = SIMULATION_PARAMS;
  const trad = p.traditional_workflow;
  const qr = p.qr_secured_workflow;

  // Timp ospătar per masă (Tradițional)
  const tradWaiterTimePerOrderSec = trad.waiter_walk_to_table_sec + trad.waiter_write_paper_sec + trad.waiter_walk_to_kitchen_sec;
  const tradTotalWaiterTimeSec = (tradWaiterTimePerOrderSec * p.orders_per_table + trad.waiter_bill_delivery_sec) * p.tables_count;

  // Timp până la intrarea comenzii în bucătărie din momentul deciziei clientului (Tradițional)
  const tradLeadTimeToKitchenSec = trad.waiter_walk_to_table_sec + trad.waiter_write_paper_sec + trad.waiter_walk_to_kitchen_sec + trad.kitchen_ticket_input_sec;

  // Timp ospătar per masă (Platformă QR Securizată)
  // Ospătarul intervine doar la servirea preparatului și plata notei
  const qrTotalWaiterTimeSec = (30 * p.orders_per_table + 30) * p.tables_count; // economie masivă de deplasări administrative

  // Timp până la intrarea comenzii în bucătărie (Platformă QR)
  // Include fereastra de anulare de 25s
  const qrLeadTimeToKitchenSec = qr.customer_qr_scan_sec + qr.order_digital_transmission_sec + qr.cancellation_window_sec;

  const results = {
    meta: {
      generated_at: new Date().toISOString(),
      label: "Rezultate Simulare Eficiență Operațională HoReCa",
      disclaimer: "Această analiză este o SIMULARE algoritmică bazată pe parametri presupuși. În lipsa unui restaurant partener, nu s-au efectuat măsurători fizice ale timpilor de servire."
    },
    metrics: {
      traditional_lead_time_to_kitchen_sec: tradLeadTimeToKitchenSec,
      qr_platform_lead_time_to_kitchen_sec: qrLeadTimeToKitchenSec,
      lead_time_reduction_percent: Number((((tradLeadTimeToKitchenSec - qrLeadTimeToKitchenSec) / tradLeadTimeToKitchenSec) * 100).toFixed(1)),
      traditional_waiter_hours_20_tables: Number((tradTotalWaiterTimeSec / 3600).toFixed(2)),
      qr_platform_waiter_hours_20_tables: Number((qrTotalWaiterTimeSec / 3600).toFixed(2)),
      waiter_time_saved_percent: Number((((tradTotalWaiterTimeSec - qrTotalWaiterTimeSec) / tradTotalWaiterTimeSec) * 100).toFixed(1))
    }
  };

  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(resultsDir, 'sim-params.json'), JSON.stringify(SIMULATION_PARAMS, null, 2), 'utf8');
  fs.writeFileSync(path.join(resultsDir, 'sim-results.json'), JSON.stringify(results, null, 2), 'utf8');

  let md = '# Simulare a Eficienței Operaționale (T06)\n\n';
  md += `> [!NOTE]\n`;
  md += `> **Etichetă obligatorie**: ${results.meta.disclaimer}\n\n`;
  md += '### Parametri de simulare utilizați (`results/sim-params.json`)\n';
  md += `- **Mese active**: ${p.tables_count} mese (${p.average_party_size} persoane/masă).\n`;
  md += `- **Comenzi per masă**: ${p.orders_per_table} runde.\n`;
  md += `- **Timp deplasare și notare tradițională**: ${trad.waiter_walk_to_table_sec}s deplasare + ${trad.waiter_write_paper_sec}s notare + ${trad.waiter_walk_to_kitchen_sec}s drum spre bucătărie.\n`;
  md += `- **Flux digital**: Transmitere instantă + ${qr.cancellation_window_sec}s fereastră anulare.\n\n`;
  md += '### Rezultate Comparative ale Simulării:\n\n';
  md += '| Indicator Operațional | Flux Tradițional (Hârtie) | Platformă QR Securizată | Variație Similată |\n';
  md += '| :--- | :---: | :---: | :---: |\n';
  md += `| **Timp transmitere comandă în bucătărie** | ${tradLeadTimeToKitchenSec} secunde | ${qrLeadTimeToKitchenSec} secunde | **-${results.metrics.lead_time_reduction_percent}%** |\n`;
  md += `| **Timp total alocat de ospătari (20 mese)** | ${results.metrics.traditional_waiter_hours_20_tables} ore | ${results.metrics.qr_platform_waiter_hours_20_tables} ore | **-${results.metrics.waiter_time_saved_percent}%** |\n\n`;
  md += '### Observații:\n';
  md += '1. Fereastra de 25s de anulare protejează bucătăria împotriva greșelilor fără a penaliza fluxul față de notarea pe hârtie (care dura ~180 secunde).\n';
  md += '2. Personalul de servire își poate redirecționa atenția către ospitalitate și debarasare în loc de sarcini clericale de preluare comenzi.\n';

  fs.writeFileSync(path.join(resultsDir, 'sim-results.md'), md, 'utf8');
  console.log('Simulare finalizată cu succes. Rezultate salvate în results/sim-params.json și results/sim-results.md');
  return results;
}

runSimulation();

