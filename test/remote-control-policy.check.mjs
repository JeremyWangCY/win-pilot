import assert from 'node:assert/strict'
import {assessRemoteConflict} from '../lib/remote-session-guard.js'
import {WIN_PILOT_SETTINGS_FIELDS, WIN_PILOT_SETTINGS_DEFAULTS, setSettingsForTest, resetSettingsForTest, getSettings} from '../lib/settings.js'
import {validateHostSettings} from '../lib/host-context.js'

// 1. The policy is a declared, defaulted, editable enum.
{
  const field=WIN_PILOT_SETTINGS_FIELDS.find(f=>f.key==='remoteControlPolicy')
  assert.ok(field,'remoteControlPolicy must be declared')
  assert.equal(field.type,'enum')
  assert.deepEqual([...field.values],['fallback','refuse'])
  assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.remoteControlPolicy,'fallback',
    'the safe default must not refuse work the user asked for')
}

// 2. A bad value falls back to the default instead of being honoured.
{
  setSettingsForTest({remoteControlPolicy:'explode'})
  assert.equal(getSettings().remoteControlPolicy,'fallback')
  setSettingsForTest({remoteControlPolicy:'refuse'})
  assert.equal(getSettings().remoteControlPolicy,'refuse')
  resetSettingsForTest()
}

// 3. Host-context validation accepts the field and rejects an unknown policy.
{
  const base={overlay:true,statusPill:true,browserHeadlessDefault:false,desktopEnvironment:'task'}
  assert.equal(validateHostSettings({...base,remoteControlPolicy:'fallback'}).remoteControlPolicy,'fallback')
  assert.equal(validateHostSettings({...base,remoteControlPolicy:'refuse'}).remoteControlPolicy,'refuse')
  // An older host payload without the key must still validate, defaulting safely.
  assert.equal(validateHostSettings({...base}).remoteControlPolicy,'fallback')
  assert.throws(()=>validateHostSettings({...base,remoteControlPolicy:'nonsense'}))
}

// 4. The three verdicts a caller must distinguish.
{
  const ok={ok:true,remote_active:false,console_active:true,child_session_present:false,child_session_id:null,child_sessions_enabled:true,
    sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false}]}
  const attached={...ok,remote_active:true,
    sessions:[...ok.sessions,{session_id:2,user:'me',state:0,child_session:false,client_protocol_type:2,remote:true}]}
  const broken={ok:false,error_code:'task_desktop_probe_failed'}

  const clean=assessRemoteConflict(ok)
  assert.equal(clean.allow,true)
  assert.equal(clean.reason,'no_conflict')

  const blocked=assessRemoteConflict(attached)
  assert.equal(blocked.allow,false)
  assert.equal(blocked.reason,'remote_in_use')
  assert.match(blocked.message,/远程控制/)

  const failed=assessRemoteConflict(broken)
  assert.equal(failed.allow,false,'an unreadable probe must not look like "no remote"')
  assert.equal(failed.reason,'probe_failed')
}

// 5. A disconnected remote session is not an active conflict.
{
  const disconnected={ok:true,remote_active:false,console_active:true,child_session_present:false,child_session_id:null,child_sessions_enabled:true,
    sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false},
              {session_id:4,user:'me',state:4,child_session:false,client_protocol_type:2,remote:true}]}
  assert.equal(assessRemoteConflict(disconnected).allow,true)
}

// A fallback result ran on the current desktop, so the outer labelling must not
// overwrite it with the selected task environment.
{
  const source=(await import('node:fs')).readFileSync(new URL('../lib/index.js',import.meta.url),'utf8')
  assert.ok(source.includes("desktop_environment:raw?.remote_control_fallback ? 'current' : desktopEnvironment"),
    'a remote-control fallback must stay labelled as the current desktop')
}

console.log('remote control policy check PASSED')
