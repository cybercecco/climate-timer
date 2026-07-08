import {
  css,
  html,
  LitElement,
  nothing,
  PropertyValues,
  TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
} from "custom-card-helpers";

interface HassEntity {
  state: string;
  attributes: Record<string, unknown>;
}

interface ClimateTimerCardConfig {
  type: string;
  entity: string;
  name?: string;
  show_current_as_primary?: boolean;
  timer_presets?: number[];
}

interface ScheduleInfo {
  off?: string | null;
  on?: string | null;
}

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
      preview?: boolean;
    }>;
  }
}

const MODE_ICONS: Record<string, string> = {
  cool: "mdi:snowflake",
  heat: "mdi:fire",
  fan_only: "mdi:fan",
  dry: "mdi:water-percent",
  auto: "mdi:autorenew",
  off: "mdi:power",
};

const MODE_ORDER = ["cool", "heat", "fan_only", "dry", "auto", "off"];

@customElement("climate-timer-card")
export class ClimateTimerCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) private _config!: ClimateTimerCardConfig;

  @state() private _schedule: ScheduleInfo = {};

  @state() private _offTime = "22:00";

  @state() private _onTime = "07:00";

  @state() private _timerDialogOpen = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./climate-timer-card-editor");
    return document.createElement(
      "climate-timer-card-editor"
    ) as LovelaceCardEditor;
  }

  public static getStubConfig(): Record<string, unknown> {
    return {
      type: "custom:climate-timer-card",
      entity: "climate.example",
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public setConfig(config: ClimateTimerCardConfig): void {
    if (!config.entity) {
      throw new Error("Entity must be specified");
    }
    this._config = {
      timer_presets: [30, 60, 120],
      ...config,
    };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._loadSchedule();
    this._subscribeUpdates();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
  }

  private _unsub?: () => void;

  private _hasActiveSchedule(): boolean {
    return Boolean(this._schedule.off || this._schedule.on);
  }

  private _subscribeUpdates(): void {
    if (!this.hass || this._unsub) return;
    void this.hass.connection
      .subscribeEvents(
        (event: { data?: { entity_id?: string; schedule?: ScheduleInfo } }) => {
          if (event.data?.entity_id === this._config.entity) {
            this._schedule = event.data.schedule ?? {};
          }
        },
        "climate_timer_updated"
      )
      .then((unsub) => {
        this._unsub = unsub;
      });
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass && !this._unsub) {
      this._subscribeUpdates();
      this._loadSchedule();
    }
  }

  private async _loadSchedule(): Promise<void> {
    if (!this.hass) return;
    try {
      const response = (await this.hass.callWS({
        type: "call_service",
        domain: "climate_timer",
        service: "get_schedule",
        service_data: { entity_id: this._config.entity },
        return_response: true,
      })) as { response?: { schedule?: ScheduleInfo }; schedule?: ScheduleInfo };
      this._schedule = response.response?.schedule ?? response.schedule ?? {};
    } catch {
      this._schedule = {};
    }
  }

  private _entity(): HassEntity | undefined {
    return this.hass?.states[this._config.entity] as HassEntity | undefined;
  }

  private _title(state: HassEntity): string {
    return (
      this._config.name ??
      (state.attributes.friendly_name as string | undefined) ??
      this._config.entity
    );
  }

  private _currentTemp(state: HassEntity): number | undefined {
    return state.attributes.current_temperature as number | undefined;
  }

  private _targetTemp(state: HassEntity): number | undefined {
    return state.attributes.temperature as number | undefined;
  }

  private _hvacMode(state: HassEntity): string {
    return state.state;
  }

  private _supportedModes(state: HassEntity): string[] {
    const modes = (state.attributes.hvac_modes as string[] | undefined) ?? [];
    return MODE_ORDER.filter((mode) => modes.includes(mode));
  }

  private _formatSchedule(iso?: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private async _callClimate(
    service: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    await this.hass.callService("climate", service, {
      entity_id: this._config.entity,
      ...data,
    });
  }

  private async _callTimer(
    service: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    await this.hass.callService("climate_timer", service, {
      entity_id: this._config.entity,
      ...data,
    });
    await this._loadSchedule();
  }

  private _openTimerDialog(ev: Event): void {
    ev.stopPropagation();
    this._timerDialogOpen = true;
  }

  private _closeTimerDialog(): void {
    this._timerDialogOpen = false;
  }

  private _renderArc(target?: number, min = 16, max = 30): TemplateResult {
    const value = target ?? (min + max) / 2;
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const angle = 135 + pct * 270;
    const rad = (angle * Math.PI) / 180;
    const cx = 100;
    const cy = 100;
    const r = 72;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const large = pct > 0.5 ? 1 : 0;
    const endAngle = 135 + 270;
    const endRad = (endAngle * Math.PI) / 180;
    const ex = cx + r * Math.cos(endRad);
    const ey = cy + r * Math.sin(endRad);

    return html`
      <svg viewBox="0 0 200 120" class="arc">
        <path class="arc-track" d="M 28 100 A 72 72 0 1 1 172 100"></path>
        <path
          class="arc-value"
          d="M 28 100 A 72 72 0 ${large} 1 ${x} ${y}"
        ></path>
        <circle class="arc-knob" cx="${x}" cy="${y}" r="8"></circle>
        <circle class="arc-end" cx="${ex}" cy="${ey}" r="3"></circle>
      </svg>
    `;
  }

  private _renderModes(state: HassEntity): TemplateResult {
    const active = this._hvacMode(state);
    return html`
      <div class="modes">
        ${this._supportedModes(state).map(
          (mode) => html`
            <button
              class="mode ${active === mode ? "active" : ""}"
              title=${mode}
              @click=${() =>
                this._callClimate("set_hvac_mode", { hvac_mode: mode })}
            >
              <ha-icon .icon=${MODE_ICONS[mode] ?? "mdi:help"}></ha-icon>
            </button>
          `
        )}
      </div>
    `;
  }

  private _renderTimerDialog(state: HassEntity): TemplateResult {
    const presets = this._config.timer_presets ?? [30, 60, 120];
    return html`
      <ha-dialog
        .open=${this._timerDialogOpen}
        @closed=${this._closeTimerDialog}
        hideActions
      >
        <div slot="heading" class="dialog-heading">
          <ha-icon icon="mdi:timer-outline"></ha-icon>
          <span>Timer · ${this._title(state)}</span>
        </div>
        <div class="dialog-body">
          <div class="timer-title">Timer spegnimento</div>
          <div class="preset-row">
            ${presets.map(
              (minutes) => html`
                <button
                  class="chip"
                  @click=${() =>
                    this._callTimer("schedule_off", { minutes })}
                >
                  ${minutes} min
                </button>
              `
            )}
          </div>
          <div class="time-row">
            <label>
              <span>Spegni alle</span>
              <input
                type="time"
                .value=${this._offTime}
                @change=${(ev: Event) => {
                  this._offTime = (ev.target as HTMLInputElement).value;
                }}
              />
            </label>
            <button
              class="chip primary"
              @click=${() =>
                this._callTimer("schedule_off", { time: this._offTime })}
            >
              Programma
            </button>
          </div>
          ${this._schedule.off
            ? html`
                <div class="schedule active">
                  Spegnimento: ${this._formatSchedule(this._schedule.off)}
                  <button
                    class="link"
                    @click=${() => this._callTimer("cancel", { action: "off" })}
                  >
                    Annulla
                  </button>
                </div>
              `
            : nothing}

          <div class="timer-title spaced">Accensione programmata</div>
          <div class="time-row">
            <label>
              <span>Accendi alle</span>
              <input
                type="time"
                .value=${this._onTime}
                @change=${(ev: Event) => {
                  this._onTime = (ev.target as HTMLInputElement).value;
                }}
              />
            </label>
            <button
              class="chip primary"
              @click=${() =>
                this._callTimer("schedule_on", { time: this._onTime })}
            >
              Programma
            </button>
          </div>
          ${this._schedule.on
            ? html`
                <div class="schedule active">
                  Accensione: ${this._formatSchedule(this._schedule.on)}
                  <button
                    class="link"
                    @click=${() => this._callTimer("cancel", { action: "on" })}
                  >
                    Annulla
                  </button>
                </div>
              `
            : nothing}
        </div>
      </ha-dialog>
    `;
  }

  protected render(): TemplateResult {
    const state = this._entity();
    if (!state) {
      return html`<ha-card><div class="warning">Entity not found</div></ha-card>`;
    }

    const current = this._currentTemp(state);
    const target = this._targetTemp(state);
    const mode = this._hvacMode(state);
    const min = (state.attributes.min_temp as number | undefined) ?? 16;
    const max = (state.attributes.max_temp as number | undefined) ?? 30;
    const showCurrent = this._config.show_current_as_primary ?? true;

    return html`
      <ha-card>
        <div class="header">
          <div class="name">${this._title(state)}</div>
          <button
            class="timer-btn ${this._hasActiveSchedule() ? "active" : ""}"
            title="Timer programmato"
            @click=${this._openTimerDialog}
          >
            <ha-icon icon="mdi:timer-outline"></ha-icon>
            ${this._hasActiveSchedule()
              ? html`<span class="timer-dot"></span>`
              : nothing}
          </button>
        </div>

        <div class="main">
          ${this._renderArc(target, min, max)}
          <div class="center">
            <div class="mode-label">${mode === "off" ? "Off" : mode}</div>
            <div class="temperature">
              ${showCurrent && current != null
                ? html`<span class="current">${current.toFixed(1)}</span>`
                : html`<span class="current">${target?.toFixed(0) ?? "--"}</span>`}
              <span class="unit">°C</span>
            </div>
            ${target != null
              ? html`
                  <div class="target-row">
                    <ha-icon icon="mdi:account"></ha-icon>
                    <span>${target.toFixed(0)} °C</span>
                  </div>
                `
              : nothing}
          </div>
        </div>

        ${this._renderModes(state)}
        ${this._renderTimerDialog(state)}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }
    ha-card {
      overflow: hidden;
    }
    .warning {
      padding: 16px;
      color: var(--error-color);
    }
    .header {
      position: relative;
      padding: 16px 48px 0 16px;
      text-align: center;
    }
    .name {
      font-size: 1.1rem;
      font-weight: 500;
    }
    .timer-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.75;
    }
    .timer-btn:hover,
    .timer-btn.active {
      opacity: 1;
      background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
    }
    .timer-dot {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--primary-color);
    }
    .main {
      position: relative;
      height: 132px;
    }
    .arc {
      width: 100%;
      height: 132px;
    }
    .arc-track,
    .arc-value {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
    }
    .arc-track {
      stroke: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.12);
    }
    .arc-value {
      stroke: var(--primary-color);
    }
    .arc-knob {
      fill: var(--primary-text-color);
    }
    .arc-end {
      fill: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.35);
    }
    .center {
      position: absolute;
      inset: 20px 0 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .mode-label {
      font-size: 0.95rem;
      opacity: 0.8;
      text-transform: capitalize;
    }
    .temperature {
      display: flex;
      align-items: flex-start;
      line-height: 1;
    }
    .current {
      font-size: 2.4rem;
      font-weight: 300;
    }
    .unit {
      font-size: 1rem;
      margin-top: 0.35rem;
      margin-left: 2px;
    }
    .target-row {
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0.75;
      font-size: 0.85rem;
    }
    .modes {
      display: flex;
      justify-content: center;
      gap: 8px;
      padding: 4px 12px 12px;
    }
    .mode {
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 12px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .mode.active {
      background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.12);
    }
    ha-dialog {
      --dialog-content-padding: 0;
    }
    .dialog-heading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
      font-weight: 500;
    }
    .dialog-body {
      padding: 8px 24px 24px;
      min-width: min(360px, 90vw);
    }
    .timer-title {
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 8px;
      opacity: 0.85;
    }
    .timer-title.spaced {
      margin-top: 16px;
    }
    .preset-row,
    .time-row {
      display: flex;
      gap: 8px;
      align-items: end;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .chip {
      border: 1px solid rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.18);
      background: transparent;
      color: inherit;
      border-radius: 999px;
      padding: 8px 14px;
      cursor: pointer;
    }
    .chip.primary {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.75rem;
      opacity: 0.8;
    }
    input[type="time"] {
      background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.06);
      border: 1px solid rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.18);
      border-radius: 8px;
      color: inherit;
      padding: 8px 10px;
    }
    .schedule {
      font-size: 0.8rem;
      opacity: 0.85;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .link {
      border: none;
      background: none;
      color: var(--primary-color);
      cursor: pointer;
      padding: 0;
    }
  `;
}

(window.customCards ??= []).push({
  type: "climate-timer-card",
  name: "Climate Timer Card",
  description: "Climate card con timer di accensione/spegnimento programmato",
  preview: true,
});
