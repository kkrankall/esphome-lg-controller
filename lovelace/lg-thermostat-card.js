// LG Thermostat Card: a Home Assistant dashboard card for the ESPHome LG controller.
//
// Shows the climate entity with its presets (Home, Away, Sleep, Boost), mode, fan, the next
// change from a Scheduler schedule, vane positions (wall unit, 4-way ceiling cassette or
// ducted), preset settings and unit status. The other entities of the controller (preset
// setpoints, vanes, pipe temperatures, ...) are found through the climate entity's device.
//
// Card config:
//   type: custom:lg-thermostat-card
//   entity: climate.lgmasterbedroom_lg_master_bedroom
//   name: Master bedroom            # optional, defaults to the entity name
//   unit_type: cassette             # wall (default), cassette or ducted
//   humidity_entity: sensor.x       # optional
//   schedule_entity: switch.y       # optional Scheduler schedule; found automatically if omitted

const CARD_VERSION = "0.1.1";

const PRESETS = [
  { key: "home", label: "Home", icon: "mdi:home" },
  { key: "away", label: "Away", icon: "mdi:exit-run" },
  { key: "sleep", label: "Sleep", icon: "mdi:weather-night" },
  { key: "boost", label: "Boost", icon: "mdi:rocket-launch" },
];

const MODES = {
  off: { label: "Off", icon: "mdi:power", color: "var(--state-climate-off-color, var(--disabled-text-color))" },
  cool: { label: "Cool", icon: "mdi:snowflake", color: "var(--state-climate-cool-color, #2b9af9)" },
  heat: { label: "Heat", icon: "mdi:fire", color: "var(--state-climate-heat-color, #ff8100)" },
  dry: { label: "Dry", icon: "mdi:water-percent", color: "var(--state-climate-dry-color, #efbd07)" },
  fan_only: { label: "Fan", icon: "mdi:fan", color: "var(--state-climate-fan_only-color, #8a8a8a)" },
  heat_cool: { label: "Auto", icon: "mdi:sun-snowflake-variant", color: "var(--state-climate-heat_cool-color, #008000)" },
};
const MODE_ORDER = ["off", "cool", "heat", "dry", "fan_only", "heat_cool"];

const FANS = { auto: "Auto", quiet: "Quiet", low: "Low", medium: "Med", high: "High", focus: "Jet" };
const FAN_ORDER = ["auto", "quiet", "low", "medium", "high", "focus"];

const UNIT_TYPES = {
  wall: { label: "Wall unit", icon: "mdi:air-conditioner", vanes: 1 },
  cassette: { label: "4-way ceiling cassette", icon: "mdi:view-grid-outline", vanes: 4 },
  ducted: { label: "Ducted", icon: "mdi:hvac", vanes: 0 },
};

// Suffixes of the controller's entity IDs, as created by the ESPHome config in this repo.
const SUFFIXES = {
  home_cool: "number._home_cool_setpoint",
  home_heat: "number._home_heat_setpoint",
  home_fan: "select._home_fan_mode",
  away_cool: "number._away_cool_setpoint",
  away_heat: "number._away_heat_setpoint",
  away_fan: "select._away_fan_mode",
  sleep_cool: "number._sleep_cool_setpoint",
  sleep_heat: "number._sleep_heat_setpoint",
  sleep_fan: "select._sleep_fan_mode",
  offset: "number._setpoint_offset",
  boost_duration: "number._boost_duration",
  boost_remaining: "sensor._boost_remaining",
  sleep_timer: "number._sleep_timer_minutes",
  vane1: "select._airflow_1_up_down",
  vane2: "select._airflow_2_up_down",
  vane3: "select._airflow_3_up_down",
  vane4: "select._airflow_4_up_down",
  outdoor: "binary_sensor._outdoor_unit",
  defrost: "binary_sensor._defrost",
  preheat: "binary_sensor._preheat",
  pipe_in: "sensor._pipe_temperature_in",
  pipe_out: "sensor._pipe_temperature_out",
  error: "sensor._error_code",
  wifi: "sensor._wifi_signal",
};

const VANE_LABELS = ["Auto", "1 Up", "2", "3", "4", "5", "6 Down"];

class LgThermostatCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "control";
    this._vane = "all";
    this._pendingTarget = null;
    this._signature = "";
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
  }

  static getStubConfig(hass) {
    const climate = Object.keys(hass.states).find((id) => id.startsWith("climate.lg")) ||
      Object.keys(hass.states).find((id) => id.startsWith("climate."));
    return { entity: climate || "climate.example", unit_type: "wall" };
  }

  setConfig(config) {
    if (!config || !config.entity || !config.entity.startsWith("climate.")) {
      throw new Error("Set 'entity' to the LG controller's climate entity");
    }
    if (config.unit_type && !UNIT_TYPES[config.unit_type]) {
      throw new Error("unit_type must be wall, cassette or ducted");
    }
    this._config = { unit_type: "wall", ...config };
    this._entities = null;
    this._signature = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._entities) this._entities = this._findEntities();
    const signature = this._computeSignature();
    if (signature !== this._signature) {
      this._signature = signature;
      this._render();
    }
  }

  getCardSize() {
    return 7;
  }

  // Finds the controller's other entities: through the device of the climate entity when the
  // entity registry is available, else by the climate entity's object ID prefix.
  _findEntities() {
    const hass = this._hass;
    const climateId = this._config.entity;
    let candidates = Object.keys(hass.states);
    const reg = hass.entities && hass.entities[climateId];
    if (reg && reg.device_id) {
      candidates = Object.values(hass.entities)
        .filter((e) => e.device_id === reg.device_id)
        .map((e) => e.entity_id);
    } else {
      const prefix = climateId.split(".")[1].split("_")[0];
      candidates = candidates.filter((id) => id.split(".")[1].startsWith(prefix + "_"));
    }
    const found = {};
    for (const [key, spec] of Object.entries(SUFFIXES)) {
      const [domain, suffix] = [spec.slice(0, spec.indexOf(".")), spec.slice(spec.indexOf(".") + 1)];
      found[key] = candidates.find((id) => id.startsWith(domain + ".") && id.endsWith(suffix)) || null;
    }
    return found;
  }

  _scheduleEntity() {
    if (this._config.schedule_entity) return this._config.schedule_entity;
    const id = this._config.entity;
    const schedules = Object.values(this._hass.states).filter((s) =>
      s.entity_id.startsWith("switch.schedule") &&
      Array.isArray(s.attributes.entities) && s.attributes.entities.includes(id));
    const on = schedules.find((s) => s.state === "on");
    return (on || schedules[0] || {}).entity_id || null;
  }

  _computeSignature() {
    const ids = [this._config.entity, this._config.humidity_entity, this._scheduleEntity(),
      ...Object.values(this._entities || {})].filter(Boolean);
    return ids.map((id) => {
      const s = this._hass.states[id];
      return s ? id + "=" + s.state + JSON.stringify(s.attributes) : id + "=missing";
    }).join("|");
  }

  _state(key) {
    const id = this._entities && this._entities[key];
    return id ? this._hass.states[id] : undefined;
  }

  _call(domain, service, data) {
    this._hass.callService(domain, service, data);
  }

  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const { action, value } = el.dataset;
    const entity_id = this._config.entity;
    const climate = this._hass.states[entity_id];
    switch (action) {
      case "tab":
        this._tab = value;
        this._render();
        break;
      case "preset":
        this._call("climate", "set_preset_mode", { entity_id, preset_mode: value });
        break;
      case "mode":
        this._call("climate", "set_hvac_mode", { entity_id, hvac_mode: value });
        break;
      case "fan":
        this._call("climate", "set_fan_mode", { entity_id, fan_mode: value });
        break;
      case "temp": {
        // Collect quick taps and send one set_temperature.
        const step = climate.attributes.target_temp_step || 1;
        const base = this._pendingTarget ?? climate.attributes.temperature;
        const next = Math.min(climate.attributes.max_temp, Math.max(climate.attributes.min_temp,
          Math.round((base + Number(value) * step) / step) * step));
        this._pendingTarget = next;
        this.shadowRoot.getElementById("target").textContent = this._formatTemp(next);
        clearTimeout(this._tempTimer);
        this._tempTimer = setTimeout(() => {
          this._call("climate", "set_temperature", { entity_id, temperature: this._pendingTarget });
          this._pendingTarget = null;
        }, 1200);
        break;
      }
      case "swing": {
        const modes = climate.attributes.swing_modes || [];
        const on = climate.attributes.swing_mode && climate.attributes.swing_mode !== "off";
        const swingOn = modes.includes("vertical") ? "vertical" : modes.find((m) => m !== "off");
        if (swingOn) this._call("climate", "set_swing_mode", { entity_id, swing_mode: on ? "off" : swingOn });
        break;
      }
      case "vane-select":
        this._vane = value === "all" ? "all" : Number(value);
        this._render();
        break;
      case "vane-position": {
        const index = Number(value);
        const vanes = this._vaneKeys().filter((k, i) => this._vane === "all" || this._vane === i);
        for (const key of vanes) {
          const s = this._state(key);
          if (s && s.attributes.options && s.attributes.options[index] !== undefined) {
            this._call("select", "select_option", { entity_id: s.entity_id, option: s.attributes.options[index] });
          }
        }
        break;
      }
      case "number": {
        const [key, delta] = value.split(":");
        const s = this._state(key);
        if (!s || isNaN(Number(s.state))) return;
        const step = s.attributes.step || 1;
        const v = Math.min(s.attributes.max, Math.max(s.attributes.min, Number(s.state) + Number(delta) * step));
        this._call("number", "set_value", { entity_id: s.entity_id, value: v });
        break;
      }
      case "select-next": {
        const s = this._state(value);
        if (!s || !s.attributes.options) return;
        const opts = s.attributes.options;
        this._call("select", "select_option", { entity_id: s.entity_id, option: opts[(opts.indexOf(s.state) + 1) % opts.length] });
        break;
      }
      case "more-info": {
        const e = new Event("hass-more-info", { bubbles: true, composed: true });
        e.detail = { entityId: value || entity_id };
        this.dispatchEvent(e);
        break;
      }
    }
  }

  _vaneKeys() {
    const n = UNIT_TYPES[this._config.unit_type].vanes;
    return ["vane1", "vane2", "vane3", "vane4"].slice(0, n);
  }

  _formatTemp(v) {
    if (v === undefined || v === null || isNaN(Number(v))) return "–";
    const step = this._hass.states[this._config.entity].attributes.target_temp_step || 1;
    return Number(v).toFixed(step < 1 ? 1 : 0) + "°";
  }

  _tempUnit() {
    return (this._hass.config && this._hass.config.unit_system && this._hass.config.unit_system.temperature) || "°C";
  }

  // Pipe temperatures come from the controller in Celsius.
  _pipeTemp(key) {
    const s = this._state(key);
    if (!s || isNaN(Number(s.state))) return null;
    let v = Number(s.state);
    const unit = s.attributes.unit_of_measurement;
    if (unit === "°C" && this._tempUnit() === "°F") v = v * 9 / 5 + 32;
    return Math.round(v) + "°";
  }

  _on(key) {
    const s = this._state(key);
    return s ? s.state === "on" : null;
  }

  _status(climate) {
    const mode = climate.state;
    if (mode === "off") return { label: "Off", color: MODES.off.color, icon: MODES.off.icon };
    if (this._on("defrost")) return { label: "Defrosting", color: MODES.cool.color, icon: "mdi:snowflake-melt" };
    if (this._on("preheat")) return { label: "Preheating", color: MODES.heat.color, icon: "mdi:heat-wave" };
    const m = MODES[mode] || MODES.heat_cool;
    const action = climate.attributes.hvac_action;
    if (action && action !== "off") {
      const labels = { cooling: "Cooling", heating: "Heating", drying: "Drying", fan: "Fan", idle: "Idle", defrosting: "Defrosting" };
      return { label: labels[action] || action, color: action === "idle" ? "var(--secondary-text-color)" : m.color, icon: m.icon };
    }
    const outdoor = this._on("outdoor");
    if (outdoor === false && ["cool", "heat", "heat_cool"].includes(mode)) {
      return { label: "Idle", color: "var(--secondary-text-color)", icon: m.icon };
    }
    const running = { cool: "Cooling", heat: "Heating", dry: "Drying", fan_only: "Fan", heat_cool: "Auto" };
    return { label: running[mode] || m.label, color: m.color, icon: m.icon };
  }

  _scheduleLine(climate) {
    const preset = climate.attributes.preset_mode;
    const label = (p) => (PRESETS.find((x) => x.key === p) || {}).label;
    if (preset === "boost") {
      const rem = this._state("boost_remaining");
      const mins = rem && !isNaN(Number(rem.state)) ? Number(rem.state) : null;
      return `Boost${mins ? ` · ${mins} min left` : ""}, then back to the previous setting`;
    }
    const sched = this._hass.states[this._scheduleEntity()];
    const current = label(preset) || (this._hasPresets(climate) ? "Hold" : null);
    if (!sched || sched.state !== "on" || !sched.attributes.next_trigger) {
      return current && current !== "Hold" ? `${current}` : current === "Hold" ? "Hold (no schedule running)" : "";
    }
    const at = new Date(sched.attributes.next_trigger);
    const time = at.toLocaleTimeString(this._hass.locale ? this._hass.locale.language : undefined, { hour: "numeric", minute: "2-digit" });
    const next = (sched.attributes.actions || [])[sched.attributes.next_slot];
    const data = (next && next.data) || {};
    const nextLabel = label(data.preset_mode) || (data.temperature !== undefined ? `${data.temperature}°` : "next setting");
    return `${current || "Now"} until ${time}, then ${nextLabel}`;
  }

  _hasPresets(climate) {
    const presets = climate.attributes.preset_modes || [];
    return presets.some((p) => ["home", "away", "sleep"].includes(p));
  }

  _chip(action, value, label, icon, on, extraClass = "") {
    return `<button class="chip ${on ? "on" : ""} ${extraClass}" data-action="${action}" data-value="${value}">
      ${icon ? `<ha-icon icon="${icon}"></ha-icon>` : ""}<span>${label}</span></button>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const climate = this._hass.states[this._config.entity];
    const type = UNIT_TYPES[this._config.unit_type];
    const name = this._config.name || (climate && climate.attributes.friendly_name) || this._config.entity;
    let body;
    if (!climate) {
      body = `<div class="offline">Entity ${this._config.entity} not found</div>`;
    } else if (climate.state === "unavailable" || climate.state === "unknown") {
      // No "since" time: last_changed resets when Home Assistant restarts.
      body = `<div class="offline"><ha-icon icon="mdi:lan-disconnect"></ha-icon>
        <div>Controller offline</div><div class="muted">Check the controller's power and Wi-Fi.</div></div>`;
    } else {
      body = this._renderBody(climate, type);
    }
    const status = climate && climate.state !== "unavailable" ? this._status(climate) : null;
    const offset = this._state("offset");
    const offsetVal = offset && !isNaN(Number(offset.state)) ? Number(offset.state) : 0;
    const humidity = this._config.humidity_entity && this._hass.states[this._config.humidity_entity];
    const room = climate && climate.attributes.current_temperature !== undefined && climate.attributes.current_temperature !== null
      ? `Room ${this._formatTemp(climate.attributes.current_temperature)}` : "";
    const hum = humidity && !isNaN(Number(humidity.state)) ? ` · ${Math.round(Number(humidity.state))}% humidity` : "";

    this.shadowRoot.innerHTML = `
      <style>${LgThermostatCard.styles}</style>
      <ha-card>
        <div class="header">
          <div class="unit-icon" data-action="more-info"><ha-icon icon="${type.icon}"></ha-icon></div>
          <div class="title">
            <div class="name">${name}</div>
            <div class="muted">${type.label}${room ? " · " + room : ""}${hum}</div>
          </div>
          <div class="pills">
            ${status ? `<span class="pill" style="--pill:${status.color}"><ha-icon icon="${status.icon}"></ha-icon>${status.label}</span>` : ""}
            ${offsetVal && climate && climate.attributes.preset_mode && !["none", "boost"].includes(climate.attributes.preset_mode)
              ? `<span class="pill solar"><ha-icon icon="mdi:solar-power"></ha-icon>Offset ${offsetVal > 0 ? "+" : "−"}${Math.abs(offsetVal)}°</span>` : ""}
          </div>
        </div>
        ${body}
      </ha-card>`;
  }

  _renderBody(climate, type) {
    const tabs = [["control", "Control"], ["airflow", "Airflow"], ["settings", "Settings"], ["info", "Info"]];
    const tabBar = `<div class="tabs">${tabs.map(([k, l]) =>
      `<button class="tab ${this._tab === k ? "on" : ""}" data-action="tab" data-value="${k}">${l}</button>`).join("")}</div>`;
    const panel = { control: () => this._renderControl(climate), airflow: () => this._renderAirflow(climate, type),
      settings: () => this._renderSettings(climate), info: () => this._renderInfo(climate, type) }[this._tab]();
    return tabBar + `<div class="panel">${panel}</div>`;
  }

  _renderControl(climate) {
    const a = climate.attributes;
    const mode = climate.state;
    const targetLabel = { cool: "Cool to", heat: "Heat to", dry: "Dry at", heat_cool: "Keep at", fan_only: "Fan only", off: "Off" }[mode] || "";
    const showTarget = !["off", "fan_only"].includes(mode);
    const presets = PRESETS.filter((p) => (a.preset_modes || []).includes(p.key));
    const modes = MODE_ORDER.filter((m) => (a.hvac_modes || []).includes(m));
    const fans = FAN_ORDER.filter((f) => (a.fan_modes || []).includes(f));
    const line = this._scheduleLine(climate);
    return `
      <div class="target-row">
        <button class="round" data-action="temp" data-value="-1" aria-label="Lower temperature"><ha-icon icon="mdi:minus"></ha-icon></button>
        <div class="target-box">
          <div class="target" id="target">${showTarget ? this._formatTemp(a.temperature) : MODES[mode] ? MODES[mode].label : mode}</div>
          <div class="muted small">${showTarget ? targetLabel : ""}</div>
        </div>
        <button class="round" data-action="temp" data-value="1" aria-label="Raise temperature"><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>
      ${line ? `<div class="schedule"><ha-icon icon="mdi:clock-outline"></ha-icon>${line}</div>` : ""}
      ${presets.length ? `<div class="label">Preset</div><div class="row">${presets.map((p) =>
        this._chip("preset", p.key, p.label, p.icon, a.preset_mode === p.key, p.key === "boost" ? "boost" : "")).join("")}</div>` : ""}
      <div class="label">Mode</div>
      <div class="row">${modes.map((m) => this._chip("mode", m, MODES[m].label, MODES[m].icon, mode === m)).join("")}</div>
      ${fans.length ? `<div class="label">Fan</div><div class="row">${fans.map((f) =>
        this._chip("fan", f, FANS[f], null, a.fan_mode === f)).join("")}</div>` : ""}`;
  }

  _vanePositions() {
    return this._vaneKeys().map((key) => {
      const s = this._state(key);
      if (!s || !s.attributes.options) return null;
      const i = s.attributes.options.indexOf(s.state);
      return i >= 0 ? i : null;
    });
  }

  _renderAirflow(climate, type) {
    const positions = this._vanePositions();
    const swingOn = climate.attributes.swing_mode && climate.attributes.swing_mode !== "off";
    const canSwing = (climate.attributes.swing_modes || []).some((m) => m !== "off");
    if (type.vanes === 0) {
      return `${this._diagram(type, positions, swingOn)}<div class="muted center">Ducted units don't have adjustable vanes.</div>`;
    }
    if (positions.every((p) => p === null)) {
      return `<div class="muted center">No vane entities found for this controller.</div>`;
    }
    const sel = this._vane;
    const current = sel === "all" ? positions[0] : positions[sel];
    return `
      ${this._diagram(type, positions, swingOn)}
      ${type.vanes > 1 ? `<div class="label">Vane</div><div class="row">
        ${this._chip("vane-select", "all", "All", null, sel === "all")}
        ${positions.map((p, i) => this._chip("vane-select", i, `Vane ${i + 1}`, null, sel === i)).join("")}</div>` : ""}
      <div class="label">Direction</div>
      <div class="row">${VANE_LABELS.map((l, i) => this._chip("vane-position", i, l, null, current === i)).join("")}</div>
      ${canSwing ? `<div class="setting"><span>Up-down swing</span>
        <button class="small-btn ${swingOn ? "on" : ""}" data-action="swing">${swingOn ? "On" : "Off"}</button></div>` : ""}`;
  }

  // Top view of a cassette (arrow length = how far the air is thrown) or side view of a wall unit.
  _diagram(type, positions, swing) {
    const arrow = (x1, y1, x2, y2, dashed) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="flow" ${dashed ? 'stroke-dasharray="4 4"' : ""} marker-end="url(#ah)"/>`;
    const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="var(--primary-color)" stroke-width="1.5"/></marker></defs>`;
    let g = "";
    let height = 215;
    if (type.vanes === 4) {
      // Panel at (80, 70), 140 x 140. Arrows are at most 43 long, so labels stay inside.
      const throwLen = (p) => (p === null || p === 0 ? 30 : 10 + (7 - p) * 5.5);
      height = 290;
      g += `<rect x="80" y="70" width="140" height="140" rx="10" class="body"/>
        <rect x="118" y="108" width="64" height="64" rx="4" class="grille"/>`;
      const sides = [[110, 80, 80, 8, 150, 70, 0, -1], [212, 100, 8, 80, 220, 140, 1, 0],
        [110, 192, 80, 8, 150, 210, 0, 1], [80, 100, 8, 80, 80, 140, -1, 0]];
      sides.forEach((s, i) => {
        const sel = this._vane === "all" || this._vane === i;
        const L = throwLen(positions[i]);
        g += `<rect x="${s[0]}" y="${s[1]}" width="${s[2]}" height="${s[3]}" rx="2" class="${sel ? "vane sel" : "vane"}"/>`;
        g += arrow(s[4], s[5], s[4] + s[6] * L, s[5] + s[7] * L, positions[i] === 0 || swing);
        g += `<text x="${s[4] + s[6] * (L + 12)}" y="${s[5] + s[7] * (L + 12) + 4}" class="num">${i + 1}</text>`;
      });
      g += `<text x="150" y="284" class="caption">Top view · a longer arrow throws air farther</text>`;
    } else if (type.vanes === 1) {
      const p = positions[0];
      const deg = p === null || p === 0 ? 40 : p * 12;
      const r = (deg * Math.PI) / 180;
      g += `<rect x="45" y="25" width="210" height="56" rx="14" class="body"/>
        <line x1="75" y1="71" x2="225" y2="71" class="grille-line"/>`;
      g += arrow(150, 84, 150 - Math.cos(r) * 110, 84 + Math.sin(r) * 110, p === 0 || swing);
      g += `<text x="150" y="208" class="caption">Side view · 1 is up, 6 is down</text>`;
    } else {
      height = 150;
      g += `<rect x="40" y="45" width="220" height="60" rx="6" class="body"/>`;
    }
    return `<svg viewBox="0 0 300 ${height}" class="diagram" role="img" aria-label="Vane positions">${defs}${g}</svg>`;
  }

  _numberRow(label, key, suffix = "") {
    const s = this._state(key);
    if (!s) return "";
    const v = isNaN(Number(s.state)) ? "–" : `${Number(s.state)}${suffix || s.attributes.unit_of_measurement || ""}`;
    return `<div class="setting"><span>${label}</span><span class="stepper">
      <button class="mini" data-action="number" data-value="${key}:-1" aria-label="Lower ${label}"><ha-icon icon="mdi:minus"></ha-icon></button>
      <span class="val">${v}</span>
      <button class="mini" data-action="number" data-value="${key}:1" aria-label="Raise ${label}"><ha-icon icon="mdi:plus"></ha-icon></button></span></div>`;
  }

  _renderSettings(climate) {
    const rows = ["home", "away", "sleep"].map((p) => {
      const cool = this._state(p + "_cool"), heat = this._state(p + "_heat"), fan = this._state(p + "_fan");
      if (!cool && !heat && !fan) return "";
      const cell = (key, s) => s ? `<span class="stepper">
          <button class="mini" data-action="number" data-value="${key}:-1" aria-label="Lower"><ha-icon icon="mdi:minus"></ha-icon></button>
          <span class="val">${isNaN(Number(s.state)) ? "–" : Number(s.state) + "°"}</span>
          <button class="mini" data-action="number" data-value="${key}:1" aria-label="Raise"><ha-icon icon="mdi:plus"></ha-icon></button></span>` : "–";
      return `<tr><td>${p[0].toUpperCase() + p.slice(1)}</td><td>${cell(p + "_cool", cool)}</td><td>${cell(p + "_heat", heat)}</td>
        <td>${fan ? `<button class="small-btn" data-action="select-next" data-value="${p}_fan">${fan.state}</button>` : "–"}</td></tr>`;
    }).join("");
    const presetTable = rows
      ? `<div class="label">Presets</div><table class="presets"><tr class="muted"><td></td><td>Cool</td><td>Heat</td><td>Fan</td></tr>${rows}</table>`
      : `<div class="muted center">This controller doesn't have presets yet. Flash the firmware with the presets block.</div>`;
    return `${presetTable}
      <div class="label">Boost, offset and timers</div>
      ${this._numberRow("Boost duration", "boost_duration", " min")}
      ${this._numberRow("Setpoint offset", "offset", "°")}
      ${this._numberRow("Sleep timer", "sleep_timer", " min")}`;
  }

  _renderInfo(climate, type) {
    const row = (label, value, key) => value === null || value === undefined ? "" :
      `<div class="setting" ${key ? `data-action="more-info" data-value="${this._entities[key]}"` : ""}><span>${label}</span><span>${value}</span></div>`;
    const yesNo = (key, yes, no) => { const v = this._on(key); return v === null ? null : v ? yes : no; };
    const err = this._state("error");
    const errVal = err ? (Number(err.state) ? `<span class="error">CH${String(Number(err.state)).padStart(2, "0")}</span>` : "None") : null;
    const pin = this._pipeTemp("pipe_in"), pout = this._pipeTemp("pipe_out");
    const wifi = this._state("wifi");
    return `<div class="label">Unit</div>
      ${row("Type", type.label)}
      ${row("Vanes", type.vanes ? `${type.vanes}` : "None")}
      ${row("Jet (Power fan)", (climate.attributes.fan_modes || []).includes("focus") ? "Supported" : "Not supported")}
      <div class="label">Live status</div>
      ${row("Outdoor unit", yesNo("outdoor", "Running", "Off"), "outdoor")}
      ${row("Defrost", yesNo("defrost", "Yes", "No"), "defrost")}
      ${row("Preheat", yesNo("preheat", "Yes", "No"), "preheat")}
      ${pin || pout ? row("Coil temperature", `${pin || "–"} in · ${pout || "–"} out`, "pipe_in") : ""}
      ${row("Error code", errVal, "error")}
      ${wifi && !isNaN(Number(wifi.state)) ? row("Wi-Fi signal", `${Math.round(Number(wifi.state))} dBm`, "wifi") : ""}
      <div class="muted small center">LG Thermostat Card ${CARD_VERSION}</div>`;
  }
}

LgThermostatCard.styles = `
  ha-card { padding: 16px; }
  .header { display: flex; align-items: flex-start; gap: 12px; }
  .unit-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--secondary-background-color);
    display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); cursor: pointer; flex: none; }
  .title { flex: 1; min-width: 0; }
  .name { font-size: 16px; font-weight: 500; }
  .muted { color: var(--secondary-text-color); font-size: 13px; }
  .small { font-size: 12px; }
  .center { text-align: center; margin: 12px 0; }
  .pills { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .pill { --mdc-icon-size: 16px; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 10px;
    border-radius: 999px; color: var(--pill); background: color-mix(in srgb, var(--pill) 15%, transparent); white-space: nowrap; }
  .pill.solar { --pill: var(--warning-color, #ffa600); }
  .tabs { display: flex; margin-top: 12px; border-bottom: 1px solid var(--divider-color); }
  .tab { flex: 1; padding: 8px 0; background: none; border: none; border-bottom: 2px solid transparent;
    color: var(--secondary-text-color); font: inherit; font-size: 13px; cursor: pointer; }
  .tab.on { color: var(--primary-text-color); border-bottom-color: var(--primary-color); }
  .target-row { display: flex; align-items: center; justify-content: center; gap: 24px; margin: 18px 0 6px; }
  .target-box { text-align: center; min-width: 90px; }
  .target { font-size: 44px; font-weight: 500; line-height: 1; }
  .round { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--divider-color); background: none;
    color: var(--primary-text-color); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .schedule { --mdc-icon-size: 16px; display: flex; align-items: center; justify-content: center; gap: 6px;
    color: var(--secondary-text-color); font-size: 13px; margin-top: 6px; text-align: center; }
  .label { font-size: 12px; color: var(--secondary-text-color); margin: 14px 0 6px; }
  .row { display: flex; gap: 6px; }
  .chip { --mdc-icon-size: 20px; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 7px 2px; border-radius: 8px; border: 1px solid var(--divider-color); background: none;
    color: var(--secondary-text-color); font: inherit; font-size: 12px; cursor: pointer; }
  .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .chip.on { color: var(--primary-color); border-color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .chip.boost.on { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437);
    background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
  .setting { display: flex; justify-content: space-between; align-items: center; font-size: 14px; padding: 6px 0;
    border-bottom: 1px solid var(--divider-color); }
  .setting > span:first-child { color: var(--secondary-text-color); }
  .stepper { display: inline-flex; align-items: center; gap: 6px; }
  .val { min-width: 44px; text-align: center; }
  .mini { --mdc-icon-size: 16px; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--divider-color);
    background: none; color: var(--primary-text-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  .small-btn { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 8px; border: 1px solid var(--divider-color);
    background: none; color: var(--primary-text-color); cursor: pointer; }
  .small-btn.on { color: var(--primary-color); border-color: var(--primary-color); }
  table.presets { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.presets td { padding: 4px 0; }
  table.presets td:not(:first-child) { text-align: center; }
  .diagram { display: block; width: 100%; max-height: 260px; margin-top: 10px; }
  .diagram .body { fill: none; stroke: var(--secondary-text-color); }
  .diagram .grille { fill: none; stroke: var(--divider-color); stroke-dasharray: 2 3; }
  .diagram .grille-line { stroke: var(--divider-color); stroke-dasharray: 2 3; }
  .diagram .vane { fill: var(--divider-color); }
  .diagram .vane.sel { fill: var(--primary-color); }
  .diagram .flow { stroke: var(--primary-color); stroke-width: 2; }
  .diagram .num { fill: var(--secondary-text-color); font-size: 12px; text-anchor: middle; }
  .diagram .caption { fill: var(--secondary-text-color); font-size: 11px; text-anchor: middle; }
  .offline { --mdc-icon-size: 32px; display: flex; flex-direction: column; align-items: center; gap: 4px;
    margin: 24px 0 8px; color: var(--secondary-text-color); }
  .error { color: var(--error-color, #db4437); }
`;

customElements.define("lg-thermostat-card", LgThermostatCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "lg-thermostat-card",
  name: "LG Thermostat Card",
  description: "Presets, Boost, vanes and status for the ESPHome LG controller",
});
