# Climate Timer

Climate card per Home Assistant con timer di accensione/spegnimento programmato.

![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1+-blue.svg)
![HACS Integration](https://img.shields.io/badge/HACS-Integration-green.svg)

## Funzionalità

- Replica lo stile della **climate card** standard di Home Assistant
- Timer spegnimento con preset **30 / 60 / 120 minuti**
- Spegnimento e accensione a **orario specifico**
- Timer persistenti dopo riavvio
- Installazione completa via **HACS** (integrazione + card Lovelace)

## Installazione HACS

1. **HACS → Integrazioni → ⋮ → Repository personalizzati**
2. Aggiungi: `https://github.com/cybercecco/climate-timer`
3. Categoria: **Integration**
4. Installa **Climate Timer** e riavvia Home Assistant
5. **Impostazioni → Dispositivi e servizi → Aggiungi integrazione → Climate Timer**

La risorsa Lovelace `/climate-timer-card/climate-timer-card.js` viene registrata automaticamente.

## Utilizzo card

```yaml
type: custom:climate-timer-card
entity: climate.sensibo_entity
name: Salotto
timer_presets:
  - 30
  - 60
  - 120
show_current_as_primary: true
```

## Servizi

| Servizio | Descrizione |
|---|---|
| `climate_timer.schedule_off` | Spegni tra N minuti o a un orario |
| `climate_timer.schedule_on` | Accendi a un orario |
| `climate_timer.cancel` | Annulla timer |
| `climate_timer.get_schedule` | Legge timer attivi |

## Sviluppo

```bash
cd climate-timer-card
npm install
npm run build
cp dist/climate-timer-card.js ../custom_components/climate_timer/www/
```

## Licenza

MIT
