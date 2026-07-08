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
  createThing,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
} from "custom-card-helpers";

interface ClimateTimerCardConfig {
  type: string;
  entity: string;
  name?: string;
  show_current_as_primary?: boolean;
  timer_presets?: number[];
  theme?: string;
  features?: unknown[];
  grid_options?: GridOptions;
}

interface GridOptions {
  columns?: number | "full";
  rows?: number;
  min_columns?: number;
  max_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

interface ScheduleInfo {
  off?: string | null;
  on?: string | null;
}

const DEFAULT_FEATURES = [{ type: "climate-hvac-modes" }];

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

@customElement("climate-timer-card")
export class ClimateTimerCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) private _config!: ClimateTimerCardConfig;

  @state() private _schedule: ScheduleInfo = {};

  @state() private _offTime = "22:00";

  @state() private _onTime = "07:00";

  @state() private _timerDialogOpen = false;

  private _nativeCard?: HTMLElement & { hass?: HomeAssistant; setConfig?: (c: unknown) => void };

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
    const native = this._nativeCard as LovelaceCard | undefined;
    if (native?.getCardSize) {
      const size = native.getCardSize();
      return typeof size === "number" ? size : 7;
    }
    return 7;
  }

  public getGridOptions(): GridOptions {
    const native = this._nativeCard as
      | (LovelaceCard & { getGridOptions?: () => GridOptions })
      | undefined;
    if (native?.getGridOptions) {
      return native.getGridOptions();
    }

    const opts = this._config?.grid_options;
    const features = this._cardFeatures().length;
    let rows = opts?.rows ?? 5;
    let min_rows = opts?.min_rows ?? 2;
    if (features > 0) {
      const featureHeight = Math.ceil((features * 2) / 3);
      rows += featureHeight;
      min_rows += featureHeight;
    }

    return {
      columns: opts?.columns ?? 12,
      rows,
      min_columns: opts?.min_columns ?? 6,
      min_rows,
      max_rows: opts?.max_rows,
      max_columns: opts?.max_columns,
    };
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

  protected firstUpdated(): void {
    this._mountNativeCard();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("_config")) {
      this._mountNativeCard();
    }
    if (this._nativeCard && changed.has("hass")) {
      this._nativeCard.hass = this.hass;
    }
    if (changed.has("hass") && this.hass && !this._unsub) {
      this._subscribeUpdates();
      this._loadSchedule();
    }
  }

  private _cardFeatures(): unknown[] {
    return this._config.features?.length
      ? this._config.features
      : DEFAULT_FEATURES;
  }

  private _thermostatConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      type: "thermostat",
      entity: this._config.entity,
      features: this._cardFeatures(),
    };
    if (this._config.name !== undefined) config.name = this._config.name;
    if (this._config.show_current_as_primary !== undefined) {
      config.show_current_as_primary = this._config.show_current_as_primary;
    }
    if (this._config.theme !== undefined) config.theme = this._config.theme;
    if (this._config.grid_options !== undefined) {
      config.grid_options = this._config.grid_options;
    }
    return config;
  }

  private _mountNativeCard(): void {
    const slot = this.renderRoot.querySelector("#native-slot");
    if (!slot || !this._config) return;

    slot.innerHTML = "";
    this._nativeCard = createThing(this._thermostatConfig()) as typeof this._nativeCard;
    if (!this._nativeCard) return;

    if (this.hass) {
      this._nativeCard.hass = this.hass;
    }
    slot.appendChild(this._nativeCard);
  }

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

  private _entityName(): string {
    const state = this.hass?.states[this._config.entity];
    return (
      this._config.name ??
      (state?.attributes?.friendly_name as string | undefined) ??
      this._config.entity
    );
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
    ev.preventDefault();
    ev.stopPropagation();
    this._timerDialogOpen = true;
  }

  private _closeTimerDialog(): void {
    this._timerDialogOpen = false;
  }

  private _renderTimerDialog(): TemplateResult {
    const presets = this._config.timer_presets ?? [30, 60, 120];
    return html`
      <ha-dialog
        .open=${this._timerDialogOpen}
        @closed=${this._closeTimerDialog}
        hideActions
      >
        <div slot="heading" class="dialog-heading">
          <ha-icon icon="mdi:timer-outline"></ha-icon>
          <span>Timer · ${this._entityName()}</span>
        </div>
        <div class="dialog-body">
          <div class="timer-title">Timer spegnimento</div>
          <div class="preset-row">
            ${presets.map(
              (minutes) => html`
                <button
                  class="chip"
                  @click=${() => this._callTimer("schedule_off", { minutes })}
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
    return html`
      <div class="wrapper">
        <div id="native-slot"></div>
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
        ${this._renderTimerDialog()}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
      height: 100%;
      box-sizing: border-box;
    }
    .wrapper {
      position: relative;
      display: block;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }
    #native-slot {
      display: block;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
    }
    #native-slot > * {
      display: block;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
    }
    .timer-btn {
      position: absolute;
      top: 10px;
      right: 44px;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--primary-text-color, inherit);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.85;
      z-index: 2;
    }
    .timer-btn:hover,
    .timer-btn.active {
      opacity: 1;
      background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.1);
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
  description: "Thermostat card nativa con timer programmato",
  preview: true,
});
