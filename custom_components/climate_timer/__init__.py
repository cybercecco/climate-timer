"""Climate Timer integration for Home Assistant."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    ATTR_DATETIME,
    ATTR_MINUTES,
    ATTR_TIME,
    DOMAIN,
    SERVICE_CANCEL,
    SERVICE_GET_SCHEDULE,
    SERVICE_SCHEDULE_OFF,
    SERVICE_SCHEDULE_ON,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)
CARD_URL = "/climate-timer-card/climate-timer-card.js"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Climate Timer from a config entry."""
    await _register_frontend(hass)
    await _ensure_lovelace_resource(hass)
    await _async_setup_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Climate Timer."""
    if DOMAIN in hass.data:
        hass.services.async_remove(DOMAIN, SERVICE_SCHEDULE_OFF)
        hass.services.async_remove(DOMAIN, SERVICE_SCHEDULE_ON)
        hass.services.async_remove(DOMAIN, SERVICE_CANCEL)
        hass.services.async_remove(DOMAIN, SERVICE_GET_SCHEDULE)
        hass.data.pop(DOMAIN)
    return True


async def _register_frontend(hass: HomeAssistant) -> None:
    """Serve the Lovelace card JavaScript."""
    if hass.data.get(DOMAIN, {}).get("frontend_registered"):
        return

    js_path = Path(__file__).parent / "www" / "climate-timer-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(js_path), cache_headers=True)]
    )
    hass.data.setdefault(DOMAIN, {})["frontend_registered"] = True


async def _ensure_lovelace_resource(hass: HomeAssistant) -> None:
    """Register the card as a Lovelace resource if missing."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        return

    resources = lovelace_data["resources"]
    existing = await resources.async_items()
    if any(item.get("url") == CARD_URL for item in existing):
        return

    await resources.async_create_item(
        {"url": CARD_URL, "type": "module", "id": f"{DOMAIN}-card"}
    )


def _parse_when(hass: HomeAssistant, call: ServiceCall) -> datetime | None:
    """Parse schedule target time from service call data."""
    if call.data.get(ATTR_MINUTES) is not None:
        minutes = int(call.data[ATTR_MINUTES])
        return dt_util.now() + timedelta(minutes=minutes)

    if call.data.get(ATTR_DATETIME):
        parsed = dt_util.parse_datetime(str(call.data[ATTR_DATETIME]))
        if parsed is not None:
            return dt_util.as_local(parsed)

    if call.data.get(ATTR_TIME):
        time_str = str(call.data[ATTR_TIME])
        now = dt_util.now()
        try:
            hour, minute = map(int, time_str.split(":")[:2])
        except ValueError:
            return None
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target

    return None


async def _async_setup_services(hass: HomeAssistant) -> None:
    """Register Climate Timer services and restore schedules."""
    if hass.services.has_service(DOMAIN, SERVICE_SCHEDULE_OFF):
        return

    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    stored = await store.async_load() or {}
    schedules: dict[str, dict[str, str | None]] = stored.get("schedules", {})
    trackers: dict[str, dict[str, Any]] = {}

    hass.data[DOMAIN] = {
        "store": store,
        "schedules": schedules,
        "trackers": trackers,
    }

    async def _persist() -> None:
        await store.async_save({"schedules": schedules})

    def _cancel_tracker(entity_id: str, action: str) -> None:
        tracker = trackers.get(entity_id, {}).pop(action, None)
        if tracker is not None:
            tracker()

    @callback
    def _fire_updated(entity_id: str) -> None:
        hass.bus.async_fire(
            f"{DOMAIN}_updated",
            {"entity_id": entity_id, "schedule": schedules.get(entity_id, {})},
        )

    async def _execute(entity_id: str, action: str) -> None:
        entity_schedules = schedules.setdefault(entity_id, {})
        if action == "off":
            state = hass.states.get(entity_id)
            if state is not None and state.state not in ("off", "unavailable", "unknown"):
                entity_schedules["last_mode"] = state.state
            await hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {ATTR_ENTITY_ID: entity_id, "hvac_mode": "off"},
                blocking=True,
            )
        elif action == "on":
            restore_mode = entity_schedules.get("last_mode") or "cool"
            await hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {ATTR_ENTITY_ID: entity_id, "hvac_mode": restore_mode},
                blocking=True,
            )

        entity_schedules[action] = None
        _cancel_tracker(entity_id, action)
        await _persist()
        _fire_updated(entity_id)

    def _schedule(entity_id: str, action: str, when: datetime) -> None:
        _cancel_tracker(entity_id, action)
        schedules.setdefault(entity_id, {})[action] = when.isoformat()

        @callback
        def _run(now: datetime) -> None:
            hass.async_create_task(_execute(entity_id, action))

        trackers.setdefault(entity_id, {})[action] = async_track_point_in_time(
            hass, _run, when
        )
        _fire_updated(entity_id)

    async def schedule_off(call: ServiceCall) -> None:
        entity_id = call.data[ATTR_ENTITY_ID]
        when = _parse_when(hass, call)
        if when is None:
            _LOGGER.error("schedule_off: invalid time for %s", entity_id)
            return
        _schedule(entity_id, "off", when)
        await _persist()

    async def schedule_on(call: ServiceCall) -> None:
        entity_id = call.data[ATTR_ENTITY_ID]
        when = _parse_when(hass, call)
        if when is None:
            _LOGGER.error("schedule_on: invalid time for %s", entity_id)
            return
        _schedule(entity_id, "on", when)
        await _persist()

    async def cancel(call: ServiceCall) -> None:
        entity_id = call.data[ATTR_ENTITY_ID]
        action = call.data.get("action", "all")
        entity_schedules = schedules.setdefault(entity_id, {})

        actions = ["off", "on"] if action == "all" else [action]
        for item in actions:
            entity_schedules[item] = None
            _cancel_tracker(entity_id, item)

        await _persist()
        _fire_updated(entity_id)

    async def get_schedule(call: ServiceCall) -> dict[str, Any]:
        entity_id = call.data[ATTR_ENTITY_ID]
        return {"schedule": schedules.get(entity_id, {})}

    hass.services.async_register(DOMAIN, SERVICE_SCHEDULE_OFF, schedule_off)
    hass.services.async_register(DOMAIN, SERVICE_SCHEDULE_ON, schedule_on)
    hass.services.async_register(DOMAIN, SERVICE_CANCEL, cancel)
    hass.services.async_register(
        DOMAIN, SERVICE_GET_SCHEDULE, get_schedule, supports_response=True
    )

    now = dt_util.now()
    for entity_id, entity_schedule in list(schedules.items()):
        for action, iso_value in list(entity_schedule.items()):
            if action == "last_mode" or not iso_value:
                continue
            when = dt_util.parse_datetime(iso_value)
            if when is None:
                entity_schedule[action] = None
                continue
            when = dt_util.as_local(when)
            if when <= now:
                hass.async_create_task(_execute(entity_id, action))
            else:
                _schedule(entity_id, action, when)

    await _persist()
