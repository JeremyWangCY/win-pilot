// Model-facing instructions registered with DSH's runtime skill registry.
// Keep the catalog entry narrow; resolve the configured policy at skill load.
const CURRENT_BOUNDARY = `- Work inside the user's current interactive Windows session. The user may continue working normally while Win-Pilot prefers background-safe browser/UIA/window-message paths.
- Real foreground input can affect the user's keyboard/mouse. Report \`background_unavailable\` accurately instead of stacking speculative background clicks.
- Treat capture and input as separate capabilities. A valid WGC/PrintWindow frame is evidence that the window can be observed while covered; it is not evidence that background keyboard/mouse delivery is supported.`
const TASK_BOUNDARY = `- All computer actions for this task run in the configured independent Windows desktop. Keep this task bound to that desktop, including observations, clipboard, app launches, recovery, and browser operations.
- Foreground input inside this task desktop is allowed and is the default when background delivery is unsuitable. It does not require permission to control the user's main desktop.
- If this desktop is unavailable, report the failure and stop. Never fall back to the main desktop or attach to its windows or browsers.
- Browser operations require the exact endpoint returned by a successful browser launch in this task and this runtime. An arbitrary loopback endpoint or one from another task is not owned.`
const CURRENT_INPUT = '- Desktop input is background-first. Use foreground interaction only when the background path is unavailable and the user explicitly asked for foreground control.'
const TASK_INPUT = '- Prefer semantic actions; foreground interaction within the configured task desktop is allowed. Recover and observe inside that same desktop.'

export const WIN_PILOT_SKILL = Object.freeze({
  name: 'win-pilot',
  description: 'Operate a Windows desktop and Win-Pilot-owned Chromium browser. Use for multi-step UI work or recovery.',
  whenToUse: 'Load before the first desktop action for the configured input policy; reuse for multi-step desktop/browser work and recovery.',
  source: 'runtime',
  content: `# Win-Pilot computer use

Use the \`computer\` tool for Windows apps and Win-Pilot-owned Chromium sessions. Preserve the current target and act from observed state; do not invent element ids, coordinates, tab ids, URLs, or success.

## Runtime boundary
${CURRENT_BOUNDARY}

## Keep the target stable
- Reuse the returned \`window\` or \`browser: { endpoint, tab_id }\` target object. The legacy \`browser_endpoint\` / \`tab_id\` fields remain valid. Recover in place before opening or launching a replacement.
${CURRENT_INPUT}

## Observe only when needed
- \`get_window_state\` is screenshot-first. Add \`include_text: true\` only when you need indexed UIA elements, document text, or \`accessibility_status\`.
- An \`element_index\` is valid only with the \`snapshot_id\` from the same state. Browser element tokens and short \`@eN\` refs are valid only for their current tab/document; stale refs are rejected.
- Reuse a returned \`post_action_observation\` when it already contains the evidence needed for the next decision. Do not call \`get_window_state\`, \`browser_state\`, or \`browser_observe\` merely because an action occurred.
- Refresh state when a snapshot/token is stale, the tool returns \`needs_observation\` or \`unknown\`, the target changed, or the next action needs information the current result does not contain.

## Act and verify
- Prefer semantic element actions over coordinates. If coordinates are necessary, use the current screenshot and include \`expected_name\` when available.
- Use \`expect\` when there is a concrete success condition. For a short predictable \`actions\` sequence, a step may also use \`when\` as a pre-dispatch gate; default to an immediate check and add a bounded timeout only when waiting is useful. Use this to remove obvious round-trips, not to encode brittle branching workflows.
- Treat an \`unknown\` mutation outcome as uncertain and inspect the same target; do not repeat the mutation automatically.
- On stale state, loading, timeout, or \`background_unavailable\`, take the narrowest evidence-backed recovery on the current target rather than restarting the app/browser.

## Browser tasks
- Reuse the exact \`browser: { endpoint, tab_id }\` target returned by Win-Pilot (legacy \`browser_endpoint\` / \`tab_id\` remain compatible). Prefer compact \`browser_observe\` for model-facing semantic state: it returns short \`@eN\` refs without raw UUID token noise. \`browser_state\` preserves both refs and raw tokens for compatibility. Observe when needed, not as a mandatory extra step after every action.
- For file inputs, \`browser_upload\` only selects explicit absolute file paths on an observed \`@eN\`/token and verifies the selection. It does not choose local files or submit the surrounding form for the agent.
- For canvas or other non-semantic targets, request \`browser_observe { with_screenshot: true }\` and bind \`browser_click_point\` to that exact \`screenshot_id\`. A changed tab/document/URL or stale screenshot is rejected.
- If an action already verifies its result, continue from that result. If it reports \`needs_observation\`, refresh that same tab before trusting the changed field or page.

## Control and capabilities
- Use \`stop\` to cancel this session's active/queued work and block input until explicit \`resume\`. Observation remains available. Control actions cannot be batched. A blocked native OS/UIA call may require helper termination and return an unknown outcome.
- Desktop indexes are stable and sparse; bind each to its single-use \`snapshot_id\`. Apply accessibility full/delta/no_change against its base revision. Hidden observations do not advance the model-visible baseline; use \`disable_diffing:true\` for a full tree.
- \`paste\` accepts \`format: text | html | md\`, with text fallback and preservation of supported original clipboard formats. Markdown is a limited subset; concurrent user clipboard changes are retained.
- Read browser capabilities. \`browser_frames\` supports same-origin child frames via \`frame_id\` and semantic references. Cross-origin/OOPIF frames and subframe coordinates are rejected. The connection uses explicit loopback CDP; no user-browser extension is included.
- \`browser_claim_tab\` binds ownership to this control session. Pass \`claim_id\` for mutations and use \`browser_finalize\` to release without activating the tab. Arm \`browser_filechooser\` before opening a chooser, read its event, and upload explicit absolute paths with its single-use \`filechooser_id\` within 60 seconds.

## Finish
Preserve the user's existing windows and tabs. Close only temporary resources created for the task, after the requested result is established.`,
})

export function createWinPilotSkill(desktopEnvironment = 'current') {
  if (desktopEnvironment !== 'task') return WIN_PILOT_SKILL
  return Object.freeze({
    ...WIN_PILOT_SKILL,
    content: WIN_PILOT_SKILL.content.replace(CURRENT_BOUNDARY, TASK_BOUNDARY).replace(CURRENT_INPUT, TASK_INPUT),
  })
}

export const WIN_PILOT_SKILL_HINT = 'Load `win-pilot` before the first desktop action for the configured input policy; reuse it for multi-step work and recovery.'
