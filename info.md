# Climate Timer

Climate card per Home Assistant con timer di accensione/spegnimento programmato.

## Funzionalità

- Replica lo stile della climate card standard
- Timer spegnimento: 30 / 60 / 120 minuti o orario specifico
- Accensione programmata a orario specifico
- Persistenza timer dopo riavvio
- Installazione completa via HACS (integrazione + card)

## Installazione HACS

1. Aggiungi repository custom: `https://github.com/cybercecco/climate-timer`
2. Categoria: **Integration**
3. Installa **Climate Timer**
4. Riavvia Home Assistant
5. Configura l'integrazione da **Impostazioni → Dispositivi e servizi**

La risorsa Lovelace viene registrata automaticamente.

## Card

```yaml
type: custom:climate-timer-card
entity: climate.mattia
name: Mattia
timer_presets:
  - 30
  - 60
  - 120
```

## Servizi

- `climate_timer.schedule_off`
- `climate_timer.schedule_on`
- `climate_timer.cancel`
- `climate_timer.get_schedule`
