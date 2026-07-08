import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, LovelaceCardEditor, LovelaceCardConfig } from "custom-card-helpers";

interface ClimateTimerCardConfig extends LovelaceCardConfig {
  entity: string;
  name?: string;
  show_current_as_primary?: boolean;
  timer_presets?: number[];
}

@customElement("climate-timer-card-editor")
export class ClimateTimerCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config!: ClimateTimerCardConfig;

  public setConfig(config: ClimateTimerCardConfig): void {
    this._config = config;
  }

  protected render() {
    if (!this.hass || !this._config) return html``;

    return html`
      <div class="card-config">
        <ha-entity-picker
          .hass=${this.hass}
          .value=${this._config.entity}
          .configValue=${"entity"}
          @value-changed=${this._valueChanged}
          label="Climate entity"
          allow-custom-entity
          .includeDomains=${["climate"]}
        ></ha-entity-picker>

        <ha-textfield
          .value=${this._config.name ?? ""}
          .configValue=${"name"}
          @input=${this._valueChanged}
          label="Nome (opzionale)"
        ></ha-textfield>

        <ha-formfield label="Mostra temperatura attuale come valore principale">
          <ha-switch
            .checked=${this._config.show_current_as_primary ?? true}
            .configValue=${"show_current_as_primary"}
            @change=${this._valueChanged}
          ></ha-switch>
        </ha-formfield>
      </div>
    `;
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const target = ev.target as HTMLElement & { configValue?: string };
    const value =
      "checked" in (ev.target as HTMLInputElement)
        ? (ev.target as HTMLInputElement).checked
        : (ev.target as HTMLInputElement).value;

    const configValue = target.configValue;
    if (!configValue) return;

    const newConfig = { ...this._config, [configValue]: value };
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }
}
