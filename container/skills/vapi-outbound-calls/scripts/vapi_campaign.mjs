#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VAPI_BASE = 'https://api.vapi.ai';
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const DEFAULT_PROMPT = path.join(SKILL_DIR, 'prompts', 'pharmacy-reservation.es-ES.md');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i+1] : null; }
function has(name) { return process.argv.includes(name); }
function die(msg) { console.error(msg); process.exit(1); }

function loadKey() {
  if (process.env.VAPI_PRIVATE_KEY) return process.env.VAPI_PRIVATE_KEY.trim();
  const cred = path.join(os.homedir(), '.config', 'vapi', 'credentials');
  if (fs.existsSync(cred)) {
    for (const line of fs.readFileSync(cred, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('VAPI_PRIVATE_KEY=')) return line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  die('[!] VAPI_PRIVATE_KEY not found in env or ~/.config/vapi/credentials');
}

async function api(method, route, body=null) {
  const res = await fetch(VAPI_BASE + route, {
    method,
    headers: {
      'Authorization': `Bearer ${loadKey()}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'NanoClaw-VapiSkill/1.0'
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Vapi ${method} ${route} failed: ${res.status} ${text}`);
  return data;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inq = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i], n = text[i+1];
    if (inq) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') inq = false;
      else field += c;
    } else {
      if (c === '"') inq = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row=[]; field=''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.some(x => x)).map(r => Object.fromEntries(header.map((h,i) => [h, r[i] || ''])));
}

function phoneSpoken(e164) {
  const names = {0:'cero',1:'uno',2:'dos',3:'tres',4:'cuatro',5:'cinco',6:'seis',7:'siete',8:'ocho',9:'nueve'};
  return [...e164].filter(c => /\d/.test(c)).map(c => names[c]).join(', ');
}

function variables(campaign, target=null) {
  const c = campaign.client, item = campaign.item;
  const v = {
    client_name: c.name,
    callback_phone: c.callbackPhone,
    callback_phone_spoken: phoneSpoken(c.callbackPhone),
    item_presentation_natural: item.presentationNatural,
    item_pronunciation_hint: item.pronunciationHint || '',
    item_active_principle: item.activePrinciple || '',
    item_strength: item.strength || '',
    item_format: item.format || '',
    item_units: String(item.units || 1),
    item_prescription: item.prescription || 'unknown',
  };
  Object.assign(v, target ? {
    pharmacy_name: target.name || 'Farmacia',
    pharmacy_address: target.address || '',
    pharmacy_postcode: target.postcode || '',
    pharmacy_phone: target.phone || '',
  } : {
    pharmacy_name: 'Farmacia de prueba', pharmacy_address: 'Dirección de prueba', pharmacy_postcode: '', pharmacy_phone: ''
  });
  return v;
}

function assistantPayload(campaign, prompt) {
  const vapi = campaign.vapi;
  return {
    name: (vapi.assistantName || 'NanoClaw Vapi Campaign').slice(0,40),
    firstMessage: 'Buenos días. Perdone la molestia, ¿hablo con la {{pharmacy_name}}?',
    firstMessageMode: 'assistant-speaks-first',
    model: { provider: vapi.model?.provider || 'openai', model: vapi.model?.model || 'gpt-4o', temperature: vapi.model?.temperature ?? 0.3, messages: [{role:'system', content: prompt}] },
    voice: vapi.voice || vapi.fallbackVoice,
    transcriber: vapi.transcriber || {provider:'deepgram', model:'nova-2', language:'es'},
    silenceTimeoutSeconds: vapi.silenceTimeoutSeconds || 35,
    maxDurationSeconds: vapi.maxDurationSeconds || 240,
    endCallMessage: 'Muchas gracias. Adiós.',
    endCallPhrases: ['adiós'],
    voicemailDetection: {provider:'twilio', enabled:true, voicemailDetectionTypes:['machine_end_beep','machine_end_silence']},
    analysisPlan: {
      summaryPrompt: 'Resume en una frase en español si se consiguió reservar el medicamento/producto y dónde.',
      structuredDataPrompt: 'Extrae JSON con tiene_stock, reserva_confirmada, direccion_confirmada, fecha_disponible y notas. No inventes datos no dichos.',
      structuredDataSchema: {type:'object', properties:{tiene_stock:{type:'string', enum:['si','no','encargo','no_lo_saben','no_atendido','numero_equivocado']}, reserva_confirmada:{type:'string', enum:['si','no']}, direccion_confirmada:{type:['string','null']}, fecha_disponible:{type:['string','null']}, notas:{type:'string'}}, required:['tiene_stock','reserva_confirmada','notas']}
    }
  };
}

function assistantIdPath(campaignPath, campaign) {
  const p = campaign.vapi.assistantIdFile || '.vapi-assistant-id';
  return path.isAbsolute(p) ? p : path.join(path.dirname(campaignPath), p);
}

async function createAssistant(campaignPath, campaign, promptPath) {
  const aidPath = assistantIdPath(campaignPath, campaign);
  const payload = assistantPayload(campaign, fs.readFileSync(promptPath, 'utf8'));
  if (fs.existsSync(aidPath)) {
    const id = fs.readFileSync(aidPath, 'utf8').trim();
    const res = await api('PATCH', `/assistant/${id}`, payload);
    console.log(`[ok] Assistant updated: ${res.id || id}`); return res.id || id;
  }
  const res = await api('POST', '/assistant', payload);
  fs.writeFileSync(aidPath, res.id + '\n');
  console.log(`[ok] Assistant created: ${res.id}`); return res.id;
}

async function makeCall(campaign, assistantId, number, name, vars) {
  return api('POST', '/call', {assistantId, phoneNumberId: campaign.vapi.phoneNumberId, customer:{number, name}, assistantOverrides:{variableValues: vars}});
}
async function getCall(id) { return api('GET', `/call/${id}`); }
async function waitCall(id) { while (true) { const c = await getCall(id); if (['ended','failed'].includes(c.status)) return c; await new Promise(r=>setTimeout(r,5000)); } }
function summarize(call, target) {
  const sd = call.analysis?.structuredData || {};
  return {target_name:target.name||'', target_phone:target.phone||'', target_address:target.address||'', call_id:call.id||'', status:call.status||'', ended_reason:call.endedReason||'', cost_usd:call.cost || call.costBreakdown?.total || '', tiene_stock:sd.tiene_stock||'', reserva_confirmada:sd.reserva_confirmada||'', direccion_confirmada:sd.direccion_confirmada||'', fecha_disponible:sd.fecha_disponible||'', notas:sd.notas||'', summary:call.analysis?.summary||'', dashboard_url:call.id ? `https://dashboard.vapi.ai/calls/${call.id}` : ''};
}
function writeResults(campaignPath, campaign, rows) {
  const dir = path.join(path.dirname(campaignPath), 'results'); fs.mkdirSync(dir,{recursive:true});
  const ts = new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
  fs.writeFileSync(path.join(dir,`results-${ts}.json`), JSON.stringify(rows,null,2));
  const header = rows[0] ? Object.keys(rows[0]) : [];
  if (header.length) fs.writeFileSync(path.join(dir,`results-${ts}.csv`), [header.join(','), ...rows.map(r => header.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n'));
  const md = [`# Vapi campaign results — ${campaign.item.presentationNatural}`,'',`Rows: ${rows.length}`,'','| # | Target | Stock | Reserved | Address confirmed | Notes |','|---:|---|---|---|---|---|', ...rows.map((r,i)=>`| ${i+1} | ${r.target_name} | ${r.tiene_stock} | ${r.reserva_confirmada} | ${r.direccion_confirmada} | ${r.notas} |`)].join('\n')+'\n';
  fs.writeFileSync(path.join(dir,`results-${ts}.md`), md);
  console.log(`[results] ${dir}`);
}

async function main() {
  const campaignPath = arg('--campaign'); const targetsPath = arg('--targets'); const promptPath = arg('--prompt') || DEFAULT_PROMPT;
  if (!campaignPath || !targetsPath) die('Usage: node vapi_campaign.mjs --campaign campaign.json --targets targets.csv [--dry-run|--create-assistant|--test-call +34...|--run] [--only N]');
  const campaign = JSON.parse(fs.readFileSync(campaignPath,'utf8'));
  let targets = parseCsv(fs.readFileSync(targetsPath,'utf8'));
  const only = arg('--only'); if (only) targets = [targets[Number(only)-1]];
  if (has('--dry-run')) { console.log(`Campaign: ${campaign.name}`); console.log(`Item: ${campaign.item.presentationNatural}`); console.log(`Client: ${campaign.client.name} / ${campaign.client.callbackPhone}`); console.log(`PhoneNumberId: ${campaign.vapi.phoneNumberId}`); console.log(`Voice: ${JSON.stringify(campaign.vapi.voice)}`); console.log(`Targets: ${targets.length}`); targets.forEach((t,i)=>console.log(`${String(i+1).padStart(2)}. ${t.name} ${t.phone} ${t.address||''}`)); if (targets[0]) console.log(JSON.stringify(variables(campaign, targets[0]), null, 2)); return; }
  if (has('--create-assistant')) { await createAssistant(campaignPath, campaign, promptPath); return; }
  const aidPath = assistantIdPath(campaignPath, campaign); const aid = fs.existsSync(aidPath) ? fs.readFileSync(aidPath,'utf8').trim() : await createAssistant(campaignPath, campaign, promptPath);
  const test = arg('--test-call');
  if (test) { const fake={name:'Farmacia de prueba', phone:test, address:'Carrer de prueba 1', postcode:'08940'}; console.log(`[test] Calling ${test}`); const r=await makeCall(campaign, aid, test, 'Test', variables(campaign,fake)); console.log(JSON.stringify(r,null,2)); if (r.id) console.log(JSON.stringify(summarize(await waitCall(r.id), fake), null, 2)); return; }
  if (has('--run')) { const rows=[]; for (let i=0; i<targets.length; i++) { const t=targets[i]; if (!t.phone?.startsWith('+')) { console.log(`[skip] ${t.name}: invalid phone ${t.phone}`); continue; } console.log(`[${i+1}/${targets.length}] Calling ${t.name} ${t.phone}`); const r=await makeCall(campaign, aid, t.phone, t.name||'Target', variables(campaign,t)); const full=await waitCall(r.id); const row=summarize(full,t); rows.push(row); console.log(`  -> stock=${row.tiene_stock} reserved=${row.reserva_confirmada} notes=${row.notas}`); if ((campaign.behavior?.stopOnReservation ?? true) && row.reserva_confirmada === 'si') { console.log('[ok] Reservation confirmed; stopping campaign.'); break; } await new Promise(res=>setTimeout(res,(campaign.behavior?.secondsBetweenCalls||2)*1000)); } writeResults(campaignPath,campaign,rows); return; }
  die('No action specified. Use --dry-run, --create-assistant, --test-call, or --run.');
}
main().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
