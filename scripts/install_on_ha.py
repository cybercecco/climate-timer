#!/usr/bin/env python3
"""Install Climate Timer via HACS and replace Sensibo climate cards on Home Assistant."""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
from typing import Any

import websockets

REPO = "cybercecco/climate-timer"
REPO_NUMERIC_ID = "1293187058"
CARD_TYPE = "custom:climate-timer-card"
CLIMATE_CARD_TYPES = {
    "thermostat",
    "climate",
    "custom:mushroom-climate-card",
    "custom:simple-thermostat",
    "custom:better-thermostat-ui-card",
}


def replace_cards(node: Any, sensibo_entities: set[str]) -> tuple[Any, int]:
    """Recursively replace climate cards for Sensibo entities."""
    replaced = 0
    if isinstance(node, list):
        output = []
        for item in node:
            new_item, count = replace_cards(item, sensibo_entities)
            output.append(new_item)
            replaced += count
        return output, replaced
    if not isinstance(node, dict):
        return node, 0

    result = copy.deepcopy(node)
    card_type = result.get("type", "")
    entity = result.get("entity")

    if card_type in CLIMATE_CARD_TYPES or (
        "climate" in card_type and card_type != CARD_TYPE
    ):
        if isinstance(entity, str) and entity in sensibo_entities:
            result["type"] = CARD_TYPE
            result["entity"] = entity
            result.setdefault("timer_presets", [30, 60, 120])
            result.setdefault("show_current_as_primary", True)
            replaced += 1

    for key, value in list(result.items()):
        if isinstance(value, (dict, list)):
            new_value, count = replace_cards(value, sensibo_entities)
            result[key] = new_value
            replaced += count

    return result, replaced


async def run(url: str, token: str) -> None:
    ws_url = url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
    if not ws_url.endswith("/api/websocket"):
        ws_url += "/api/websocket"

    async with websockets.connect(ws_url, max_size=30 * 1024 * 1024) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            raise SystemExit(f"Auth failed: {auth}")

        msg_id = 0

        async def call(msg_type: str, **kwargs: Any) -> dict[str, Any]:
            nonlocal msg_id
            msg_id += 1
            current = msg_id
            await ws.send(json.dumps({"id": current, "type": msg_type, **kwargs}))
            while True:
                response = json.loads(await ws.recv())
                if response.get("id") == current:
                    return response

        print("Adding HACS custom repository...")
        add_repo = await call(
            "hacs/repositories/add",
            repository=REPO,
        )
        print(json.dumps(add_repo, indent=2)[:400])

        print("Installing Climate Timer from HACS...")
        install = await call(
            "hacs/repository/download",
            repository=REPO_NUMERIC_ID,
        )
        print(json.dumps(install, indent=2)[:600])

        print("Reloading config entries...")
        await call(
            "call_service",
            domain="homeassistant",
            service="reload_config_entry",
            service_data={"entry_id": "climate_timer"},
        )

        entries = await call("config_entries/get", type="config_entries/get")
        # fallback: create config entry if missing after restart note
        print("Fetching Sensibo climate entities...")
        registry = await call("config/entity_registry/list")
        sensibo = {
            item["entity_id"]
            for item in registry["result"]
            if item["entity_id"].startswith("climate.")
            and item.get("platform") == "sensibo"
        }
        print(f"Found {len(sensibo)} Sensibo climate entities: {sorted(sensibo)}")

        dashboards = await call("lovelace/dashboards/list")
        dashboard_items = dashboards.get("result") or []
        targets = [{"id": None, "title": "default"}]
        for item in dashboard_items:
            targets.append({"id": item["id"], "title": item.get("title", item["id"])})

        total_replaced = 0
        for dash in targets:
            dash_id = dash["id"]
            label = dash["title"]
            if dash_id is None:
                config_resp = await call("lovelace/config")
            else:
                config_resp = await call("lovelace/config", url_path=dash_id)
            if not config_resp.get("success"):
                print(f"Skip dashboard {label}: {config_resp.get('error')}")
                continue

            config = config_resp["result"]
            new_config, replaced = replace_cards(config, sensibo)
            if replaced == 0:
                print(f"Dashboard {label}: no Sensibo climate cards found")
                continue

            if dash_id is None:
                save = await call("lovelace/config/save", config=new_config)
            else:
                save = await call(
                    "lovelace/config/save", url_path=dash_id, config=new_config
                )
            print(f"Dashboard {label}: replaced {replaced} cards -> {save.get('success')}")
            total_replaced += replaced

        print(f"Done. Total cards replaced: {total_replaced}")
        if install.get("success"):
            print("Riavvia Home Assistant per completare l'installazione HACS.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://casa.moretto.tech")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    asyncio.run(run(args.url, args.token))


if __name__ == "__main__":
    main()
