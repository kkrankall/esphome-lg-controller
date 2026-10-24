import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import pins
from esphome.components import binary_sensor, climate, number, select, sensor, switch, uart
from esphome.const import (
    CONF_ID,
    CONF_RX_PIN,
    CONF_INTERNAL,
    CONF_UNIT_OF_MEASUREMENT,
    DEVICE_CLASS_TEMPERATURE,
)

CODEOWNERS = ["JanM321"]
DEPENDENCIES = ["uart"]
AUTO_LOAD = ["binary_sensor", "number", "switch", "sensor", "select"]

lg_controller_ns = cg.esphome_ns.namespace("lg_controller")
LgController = lg_controller_ns.class_(
    "LgController", cg.Component, uart.UARTDevice, climate.Climate
)
LgNumber = lg_controller_ns.class_("LgNumber", number.Number, cg.Component)
LgSelect = lg_controller_ns.class_("LgSelect", select.Select, cg.Component)
LgSwitch = lg_controller_ns.class_("LgSwitch", switch.Switch, cg.Component)
LgStoredNumber = lg_controller_ns.class_("LgStoredNumber", number.Number)
LgStoredSelect = lg_controller_ns.class_("LgStoredSelect", select.Select)

CONF_FAHRENHEIT = "fahrenheit"
CONF_IS_SLAVE_CONTROLLER = "is_slave_controller"

CONF_TEMPERATURE_SENSOR = "temperature_sensor"

CONF_VANE1 = "vane1"
CONF_VANE2 = "vane2"
CONF_VANE3 = "vane3"
CONF_VANE4 = "vane4"
CONF_OVERHEATING = "overheating"

CONF_FAN_SPEED_SLOW = "fan_speed_slow"
CONF_FAN_SPEED_LOW = "fan_speed_low"
CONF_FAN_SPEED_MEDIUM = "fan_speed_medium"
CONF_FAN_SPEED_HIGH = "fan_speed_high"
CONF_SLEEP_TIMER = "sleep_timer"

CONF_ERROR_CODE = "error_code"
CONF_PIPE_TEMP_IN = "pipe_temp_in"
CONF_PIPE_TEMP_MID = "pipe_temp_mid"
CONF_PIPE_TEMP_OUT = "pipe_temp_out"

CONF_DEFROST = "defrost"
CONF_PREHEAT = "preheat"
CONF_OUTDOOR = "outdoor"
CONF_AUTO_DRY_ACTIVE = "auto_dry_active"

CONF_PURIFIER = "purifier"
CONF_INTERNAL_THERMISTOR = "internal_thermistor"
CONF_AUTO_DRY = "auto_dry"

CONF_PRESETS = "presets"
CONF_HOME = "home"
CONF_AWAY = "away"
CONF_SLEEP = "sleep"
CONF_COOL_SETPOINT = "cool_setpoint"
CONF_HEAT_SETPOINT = "heat_setpoint"
CONF_PRESET_FAN_MODE = "fan_mode"
CONF_SETPOINT_OFFSET = "setpoint_offset"

# Order matches the preset index in LgController::set_preset_entities.
PRESET_KEYS = [CONF_HOME, CONF_AWAY, CONF_SLEEP]
# Must match PresetFanModes in lg-controller.h.
PRESET_FAN_OPTIONS = ["Auto", "Quiet", "Low", "Medium", "High"]

VANE_OPTIONS = ["0 (Default)", "1 (Up)", "2", "3", "4", "5", "6 (Down)"]
OVERHEATING_OPTIONS = ["0 (Default)", "1 (+4C/+6C)", "2 (+2C/+4C)", "3 (-1C/+1C)", "4 (-0.5C/+0.5C)"]

PRESET_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_COOL_SETPOINT): number.number_schema(LgStoredNumber, device_class=DEVICE_CLASS_TEMPERATURE),
        cv.Required(CONF_HEAT_SETPOINT): number.number_schema(LgStoredNumber, device_class=DEVICE_CLASS_TEMPERATURE),
        cv.Required(CONF_PRESET_FAN_MODE): select.select_schema(LgStoredSelect),
    }
)

PRESETS_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_HOME): PRESET_SCHEMA,
        cv.Required(CONF_AWAY): PRESET_SCHEMA,
        cv.Required(CONF_SLEEP): PRESET_SCHEMA,
        cv.Required(CONF_SETPOINT_OFFSET): number.number_schema(LgStoredNumber),
    }
)

CONFIG_SCHEMA = climate.climate_schema(LgController).extend(
    {
        cv.Required(CONF_RX_PIN): pins.gpio_input_pin_schema,

        cv.Required(CONF_FAHRENHEIT): cv.boolean,
        cv.Required(CONF_IS_SLAVE_CONTROLLER): cv.boolean,

        cv.Optional(CONF_TEMPERATURE_SENSOR): cv.use_id(sensor.Sensor),

        cv.Required(CONF_VANE1): select.select_schema(LgSelect),
        cv.Required(CONF_VANE2): select.select_schema(LgSelect),
        cv.Required(CONF_VANE3): select.select_schema(LgSelect),
        cv.Required(CONF_VANE4): select.select_schema(LgSelect),
        cv.Required(CONF_OVERHEATING): select.select_schema(LgSelect),

        cv.Required(CONF_FAN_SPEED_SLOW): number.number_schema(LgNumber),
        cv.Required(CONF_FAN_SPEED_LOW): number.number_schema(LgNumber),
        cv.Required(CONF_FAN_SPEED_MEDIUM): number.number_schema(LgNumber),
        cv.Required(CONF_FAN_SPEED_HIGH): number.number_schema(LgNumber),
        cv.Required(CONF_SLEEP_TIMER): number.number_schema(LgNumber),

        cv.Required(CONF_ERROR_CODE): sensor.sensor_schema(),
        cv.Required(CONF_PIPE_TEMP_IN): sensor.sensor_schema(),
        cv.Required(CONF_PIPE_TEMP_MID): sensor.sensor_schema(),
        cv.Required(CONF_PIPE_TEMP_OUT): sensor.sensor_schema(),

        cv.Required(CONF_DEFROST): binary_sensor.binary_sensor_schema(),
        cv.Required(CONF_PREHEAT): binary_sensor.binary_sensor_schema(),
        cv.Required(CONF_OUTDOOR): binary_sensor.binary_sensor_schema(),
        cv.Required(CONF_AUTO_DRY_ACTIVE): binary_sensor.binary_sensor_schema(),

        cv.Required(CONF_PURIFIER): switch.switch_schema(LgSwitch),
        cv.Required(CONF_INTERNAL_THERMISTOR): switch.switch_schema(LgSwitch),
        cv.Required(CONF_AUTO_DRY): switch.switch_schema(LgSwitch),

        cv.Optional(CONF_PRESETS): PRESETS_SCHEMA,
    }
).extend(cv.COMPONENT_SCHEMA).extend(uart.UART_DEVICE_SCHEMA)

async def new_temperature_number(config, fahrenheit, *, min_value, max_value, step):
    config.setdefault(CONF_UNIT_OF_MEASUREMENT, "°F" if fahrenheit else "°C")
    return await number.new_number(config, min_value=min_value, max_value=max_value, step=step)

async def setup_presets(var, config, fahrenheit):
    # Setpoint limits match MIN_TEMP_SETPOINT/MAX_TEMP_SETPOINT (16-30 C).
    if fahrenheit:
        setpoint_range = dict(min_value=61, max_value=86, step=1)
        offset_range = dict(min_value=-10, max_value=10, step=1)
    else:
        setpoint_range = dict(min_value=16, max_value=30, step=0.5)
        offset_range = dict(min_value=-5, max_value=5, step=0.5)

    for index, key in enumerate(PRESET_KEYS):
        preset = config[key]
        cool = await new_temperature_number(preset[CONF_COOL_SETPOINT], fahrenheit, **setpoint_range)
        heat = await new_temperature_number(preset[CONF_HEAT_SETPOINT], fahrenheit, **setpoint_range)
        fan = await select.new_select(preset[CONF_PRESET_FAN_MODE], options=PRESET_FAN_OPTIONS)
        cg.add(var.set_preset_entities(index, cool, heat, fan))

    offset = await new_temperature_number(config[CONF_SETPOINT_OFFSET], fahrenheit, **offset_range)
    cg.add(var.set_setpoint_offset(offset))

async def to_code(config):
    rx_pin = await cg.gpio_pin_expression(config[CONF_RX_PIN])

    if CONF_TEMPERATURE_SENSOR in config:
        temperature_sensor = await cg.get_variable(config[CONF_TEMPERATURE_SENSOR])
    else:
        temperature_sensor = cg.nullptr

    # Hide entities not supported for 'slave' controllers.
    if config[CONF_IS_SLAVE_CONTROLLER]:
        config[CONF_FAN_SPEED_SLOW][CONF_INTERNAL] = True
        config[CONF_FAN_SPEED_LOW][CONF_INTERNAL] = True
        config[CONF_FAN_SPEED_MEDIUM][CONF_INTERNAL] = True
        config[CONF_FAN_SPEED_HIGH][CONF_INTERNAL] = True
        config[CONF_OVERHEATING][CONF_INTERNAL] = True
        config[CONF_INTERNAL_THERMISTOR][CONF_INTERNAL] = True

    vane1 = await select.new_select(config[CONF_VANE1], options=VANE_OPTIONS)
    vane2 = await select.new_select(config[CONF_VANE2], options=VANE_OPTIONS)
    vane3 = await select.new_select(config[CONF_VANE3], options=VANE_OPTIONS)
    vane4 = await select.new_select(config[CONF_VANE4], options=VANE_OPTIONS)
    overheating = await select.new_select(config[CONF_OVERHEATING], options=OVERHEATING_OPTIONS)

    fan_speed_slow = await number.new_number(config[CONF_FAN_SPEED_SLOW], min_value=0, max_value=255, step=1)
    fan_speed_low = await number.new_number(config[CONF_FAN_SPEED_LOW], min_value=0, max_value=255, step=1)
    fan_speed_medium = await number.new_number(config[CONF_FAN_SPEED_MEDIUM], min_value=0, max_value=255, step=1)
    fan_speed_high = await number.new_number(config[CONF_FAN_SPEED_HIGH], min_value=0, max_value=255, step=1)
    sleep_timer = await number.new_number(config[CONF_SLEEP_TIMER], min_value=0, max_value=420, step=1)

    error_code = await sensor.new_sensor(config[CONF_ERROR_CODE])
    pipe_temp_in = await sensor.new_sensor(config[CONF_PIPE_TEMP_IN])
    pipe_temp_mid = await sensor.new_sensor(config[CONF_PIPE_TEMP_MID])
    pipe_temp_out = await sensor.new_sensor(config[CONF_PIPE_TEMP_OUT])

    defrost = await binary_sensor.new_binary_sensor(config[CONF_DEFROST])
    preheat = await binary_sensor.new_binary_sensor(config[CONF_PREHEAT])
    outdoor = await binary_sensor.new_binary_sensor(config[CONF_OUTDOOR])
    auto_dry_active = await binary_sensor.new_binary_sensor(config[CONF_AUTO_DRY_ACTIVE])

    purifier = await switch.new_switch(config[CONF_PURIFIER])
    internal_thermistor = await switch.new_switch(config[CONF_INTERNAL_THERMISTOR])
    auto_dry = await switch.new_switch(config[CONF_AUTO_DRY])

    var = cg.new_Pvariable(config[CONF_ID], rx_pin, temperature_sensor,
                           vane1, vane2, vane3, vane4, overheating,
                           fan_speed_slow, fan_speed_low, fan_speed_medium, fan_speed_high,
                           sleep_timer,
                           error_code, pipe_temp_in, pipe_temp_mid, pipe_temp_out,
                           defrost, preheat, outdoor, auto_dry_active,
                           purifier, internal_thermistor, auto_dry,
                           config[CONF_FAHRENHEIT], config[CONF_IS_SLAVE_CONTROLLER])
    if CONF_PRESETS in config:
        await setup_presets(var, config[CONF_PRESETS], config[CONF_FAHRENHEIT])
    await climate.register_climate(var, config)
    await cg.register_component(var, config)
    await uart.register_uart_device(var, config)
