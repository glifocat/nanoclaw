#!/usr/bin/env python3
"""Vapi outbound campaign runner.

Dependency-light by design: stdlib only (urllib/json/csv). Suitable for
NanoClaw container skills.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

VAPI_BASE = "https://api.vapi.ai"
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_PROMPT = SKILL_DIR / "prompts" / "pharmacy-reservation.es-ES.md"


def load_key() -> str:
    key = os.environ.get("VAPI_PRIVATE_KEY", "").strip()
    if key:
        return key
    cred = Path.home() / ".config" / "vapi" / "credentials"
    if cred.exists():
        for line in cred.read_text().splitlines():
            if line.startswith("VAPI_PRIVATE_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
                if key:
                    return key
    raise SystemExit("[!] VAPI_PRIVATE_KEY not found in env or ~/.config/vapi/credentials")


def api(method: str, path: str, body: dict | None = None) -> dict | list:
    key = load_key()
    data = None
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "NanoClaw-VapiSkill/1.0"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(VAPI_BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Vapi {method} {path} failed: {e.code} {txt}")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def read_targets(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def phone_spoken(e164: str) -> str:
    # Spanish-friendly digit spelling; strips leading + but keeps all digits.
    digits = [ch for ch in e164 if ch.isdigit()]
    names = {
        "0": "cero", "1": "uno", "2": "dos", "3": "tres", "4": "cuatro",
        "5": "cinco", "6": "seis", "7": "siete", "8": "ocho", "9": "nueve",
    }
    return ", ".join(names[d] for d in digits)


def variables(campaign: dict, target: dict | None) -> dict:
    client = campaign["client"]
    item = campaign["item"]
    callback = client["callbackPhone"]
    v = {
        "client_name": client["name"],
        "callback_phone": callback,
        "callback_phone_spoken": phone_spoken(callback),
        "item_presentation_natural": item["presentationNatural"],
        "item_pronunciation_hint": item.get("pronunciationHint", ""),
        "item_active_principle": item.get("activePrinciple", ""),
        "item_strength": item.get("strength", ""),
        "item_format": item.get("format", ""),
        "item_units": str(item.get("units", 1)),
        "item_prescription": item.get("prescription", "unknown"),
    }
    if target:
        v.update({
            "pharmacy_name": target.get("name", "Farmacia"),
            "pharmacy_address": target.get("address", ""),
            "pharmacy_postcode": target.get("postcode", ""),
            "pharmacy_phone": target.get("phone", ""),
        })
    else:
        v.update({
            "pharmacy_name": "Farmacia de prueba",
            "pharmacy_address": "Dirección de prueba",
            "pharmacy_postcode": "",
            "pharmacy_phone": "",
        })
    return v


def assistant_payload(campaign: dict, prompt_text: str) -> dict:
    vapi = campaign["vapi"]
    voice = vapi.get("voice") or vapi.get("fallbackVoice")
    schema = {
        "type": "object",
        "properties": {
            "tiene_stock": {"type": "string", "enum": ["si", "no", "encargo", "no_lo_saben", "no_atendido", "numero_equivocado"]},
            "reserva_confirmada": {"type": "string", "enum": ["si", "no"]},
            "direccion_confirmada": {"type": ["string", "null"]},
            "fecha_disponible": {"type": ["string", "null"]},
            "notas": {"type": "string"},
        },
        "required": ["tiene_stock", "reserva_confirmada", "notas"],
    }
    return {
        "name": vapi.get("assistantName", "NanoClaw Vapi Outbound Campaign"),
        "firstMessage": "Buenos días. Perdone la molestia, ¿hablo con la {{pharmacy_name}}?",
        "firstMessageMode": "assistant-speaks-first",
        "model": {
            "provider": vapi.get("model", {}).get("provider", "openai"),
            "model": vapi.get("model", {}).get("model", "gpt-4o"),
            "temperature": vapi.get("model", {}).get("temperature", 0.3),
            "messages": [{"role": "system", "content": prompt_text}],
        },
        "voice": voice,
        "transcriber": vapi.get("transcriber", {"provider": "deepgram", "model": "nova-2", "language": "es"}),
        "silenceTimeoutSeconds": vapi.get("silenceTimeoutSeconds", 35),
        "maxDurationSeconds": vapi.get("maxDurationSeconds", 240),
        "endCallMessage": "Muchas gracias. Adiós.",
        "endCallPhrases": ["adiós"],
        "voicemailDetection": {"provider": "twilio", "enabled": True, "voicemailDetectionTypes": ["machine_end_beep", "machine_end_silence"]},
        "analysisPlan": {
            "summaryPrompt": "Resume en una frase en español si se consiguió reservar el medicamento/producto y dónde.",
            "structuredDataPrompt": "Extrae JSON con tiene_stock, reserva_confirmada, direccion_confirmada, fecha_disponible y notas. No inventes datos no dichos.",
            "structuredDataSchema": schema,
        },
    }


def assistant_id_path(campaign_path: Path, campaign: dict) -> Path:
    p = campaign.get("vapi", {}).get("assistantIdFile", ".vapi-assistant-id")
    path = Path(p)
    return path if path.is_absolute() else campaign_path.parent / path


def create_or_update_assistant(campaign_path: Path, campaign: dict, prompt_path: Path) -> str:
    payload = assistant_payload(campaign, prompt_path.read_text())
    aid_file = assistant_id_path(campaign_path, campaign)
    if aid_file.exists():
        aid = aid_file.read_text().strip()
        res = api("PATCH", f"/assistant/{aid}", payload)
        print(f"[ok] Assistant updated: {res.get('id', aid)}")
        return res.get("id", aid)
    res = api("POST", "/assistant", payload)
    aid = res["id"]
    aid_file.write_text(aid + "\n")
    print(f"[ok] Assistant created: {aid}")
    return aid


def make_call(campaign: dict, assistant_id: str, number: str, name: str, vars_: dict) -> dict:
    payload = {
        "assistantId": assistant_id,
        "phoneNumberId": campaign["vapi"]["phoneNumberId"],
        "customer": {"number": number, "name": name},
        "assistantOverrides": {"variableValues": vars_},
    }
    return api("POST", "/call", payload)


def get_call(call_id: str) -> dict:
    return api("GET", f"/call/{call_id}")


def wait_call(call_id: str) -> dict:
    while True:
        c = get_call(call_id)
        if c.get("status") in {"ended", "failed"}:
            return c
        time.sleep(5)


def summarize(call: dict, target: dict) -> dict:
    analysis = call.get("analysis") or {}
    sd = analysis.get("structuredData") or {}
    return {
        "target_name": target.get("name", ""),
        "target_phone": target.get("phone", ""),
        "target_address": target.get("address", ""),
        "call_id": call.get("id", ""),
        "status": call.get("status", ""),
        "ended_reason": call.get("endedReason", ""),
        "cost_usd": call.get("cost", 0) or call.get("costBreakdown", {}).get("total", ""),
        "tiene_stock": sd.get("tiene_stock", ""),
        "reserva_confirmada": sd.get("reserva_confirmada", ""),
        "direccion_confirmada": sd.get("direccion_confirmada") or "",
        "fecha_disponible": sd.get("fecha_disponible") or "",
        "notas": sd.get("notas", ""),
        "summary": analysis.get("summary", ""),
        "dashboard_url": f"https://dashboard.vapi.ai/calls/{call.get('id', '')}" if call.get("id") else "",
    }


def write_results(campaign_path: Path, campaign: dict, rows: list[dict]) -> None:
    outdir = campaign_path.parent / "results"
    outdir.mkdir(exist_ok=True)
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = outdir / f"results-{ts}.json"
    csv_path = outdir / f"results-{ts}.csv"
    md_path = outdir / f"results-{ts}.md"
    json_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    if rows:
        with csv_path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)
    lines = [f"# Vapi campaign results — {campaign['item']['presentationNatural']}", "", f"Rows: {len(rows)}", "", "| # | Target | Stock | Reserved | Address confirmed | Notes |", "|---:|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        lines.append(f"| {i} | {r['target_name']} | {r['tiene_stock']} | {r['reserva_confirmada']} | {r['direccion_confirmada']} | {r['notas']} |")
    md_path.write_text("\n".join(lines) + "\n")
    print(f"[results] {json_path}")
    print(f"[results] {csv_path}")
    print(f"[results] {md_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True, type=Path)
    ap.add_argument("--targets", required=True, type=Path)
    ap.add_argument("--prompt", type=Path, default=DEFAULT_PROMPT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--create-assistant", action="store_true")
    ap.add_argument("--test-call")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--only", type=int)
    args = ap.parse_args()

    campaign = read_json(args.campaign)
    targets = read_targets(args.targets)
    if args.only:
        targets = [targets[args.only - 1]]

    if args.dry_run:
        print(f"Campaign: {campaign.get('name')}")
        print(f"Item: {campaign['item']['presentationNatural']}")
        print(f"Client: {campaign['client']['name']} / {campaign['client']['callbackPhone']}")
        print(f"PhoneNumberId: {campaign['vapi']['phoneNumberId']}")
        print(f"Voice: {campaign['vapi'].get('voice')}")
        print(f"Targets: {len(targets)}")
        for i, t in enumerate(targets, 1):
            print(f"  {i:2}. {t.get('name')} {t.get('phone')} {t.get('address','')}")
        if targets:
            print("Variables for target #1:")
            print(json.dumps(variables(campaign, targets[0]), indent=2, ensure_ascii=False))
        return

    if args.create_assistant:
        create_or_update_assistant(args.campaign, campaign, args.prompt)
        return

    aid_file = assistant_id_path(args.campaign, campaign)
    if not aid_file.exists():
        assistant_id = create_or_update_assistant(args.campaign, campaign, args.prompt)
    else:
        assistant_id = aid_file.read_text().strip()

    if args.test_call:
        fake = {"name": "Farmacia de prueba", "phone": args.test_call, "address": "Carrer de prueba 1", "postcode": "08940"}
        print(f"[test] Calling {args.test_call} with assistant {assistant_id}")
        res = make_call(campaign, assistant_id, args.test_call, "Test", variables(campaign, fake))
        print(json.dumps(res, indent=2, ensure_ascii=False))
        if res.get("id"):
            full = wait_call(res["id"])
            print(json.dumps(summarize(full, fake), indent=2, ensure_ascii=False))
        return

    if args.run:
        rows = []
        for i, t in enumerate(targets, 1):
            number = t.get("phone", "")
            if not number.startswith("+"):
                print(f"[skip] {t.get('name')}: phone not E.164: {number}")
                continue
            print(f"[{i}/{len(targets)}] Calling {t.get('name')} {number}")
            res = make_call(campaign, assistant_id, number, t.get("name", "Target"), variables(campaign, t))
            cid = res.get("id")
            if not cid:
                print(json.dumps(res, indent=2, ensure_ascii=False))
                continue
            full = wait_call(cid)
            row = summarize(full, t)
            rows.append(row)
            print(f"  -> stock={row['tiene_stock']} reserved={row['reserva_confirmada']} notes={row['notas']}")
            if campaign.get("behavior", {}).get("stopOnReservation", True) and row["reserva_confirmada"] == "si":
                print("[ok] Reservation confirmed; stopping campaign.")
                break
            time.sleep(campaign.get("behavior", {}).get("secondsBetweenCalls", 2))
        write_results(args.campaign, campaign, rows)
        return

    ap.print_help()


if __name__ == "__main__":
    main()
