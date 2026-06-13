/**
 * Real LLM-bot smoke against an ALREADY-RUNNING server (the live pm2 deploy on
 * :8080, which has LLM_BASE_URL pointed at the local Qwen model). A host creates
 * a test lobby, backfills LLM bots, and drives the game with end_phase. Confirms
 * the bots actually produce legal moves (votes/targets/chat) end to end.
 *
 * Run: node scripts/smoke-llm-bots.mjs
 */
import { BotClient } from '../packages/bots/dist/client.js';

const PORT = Number(process.env.PORT || 8080);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await wait(50);
  }
  return pred();
}

async function main() {
  const wsUrl = `ws://127.0.0.1:${PORT}/ws`;
  const host = new BotClient({ url: wsUrl, name: 'LLM Smoke Host' });
  await host.connect();
  host.send({
    v: 1,
    type: 'create_lobby',
    name: 'LLM Smoke',
    visibility: 'private',
    setupId: 'classic-nocturne',
    config: { testMode: true },
  });
  if (!(await until(() => host.lobbyId !== null))) throw new Error('no lobby (test mode gated?)');
  const roomId = host.lobbyId;
  console.log(`[llm-smoke] test lobby: ${roomId}`);

  host.send({ v: 1, type: 'test_control', action: 'add_bot', count: 6, policy: 'llm' });
  if (!(await until(() => host.lobbyMembers.length >= 7)))
    throw new Error(`lobby did not fill: ${host.lobbyMembers.length}`);
  console.log(`[llm-smoke] backfilled ${host.lobbyMembers.length} players with LLM bots`);

  host.send({ v: 1, type: 'start_game' });
  await until(() => host.capture.some((m) => m.type === 'debug_state'));
  console.log('[llm-smoke] started; god-view active. Driving phases (LLM calls take time)…');

  // Dwell ~5s per phase so async LLM bots have time to act before we advance.
  // Mid-dwell we request a fresh debug_state to catch intents/tallies that are
  // cleared by the next phase boundary.
  let phases = 0;
  const deadline = Date.now() + 260000;
  while (!host.view.over && Date.now() < deadline) {
    await wait(2500);
    host.send({ v: 1, type: 'test_control', action: 'request_state' });
    await wait(2500);
    if (host.view.over) break;
    host.send({ v: 1, type: 'test_control', action: 'end_phase' });
    phases++;
  }
  if (!host.view.over) throw new Error('game did not finish');

  // Definitive signal: debug_event mirrors EVERY validated command. Count the
  // votes and night actions bots actually submitted.
  const events = host.capture.filter((m) => m.type === 'debug_event');
  const votes = events.filter((e) => e.eventType === 'vote').length;
  const nightActs = events.filter((e) => e.eventType === 'night_action').length;
  const verdicts = events.filter((e) => e.eventType === 'verdict').length;
  const states = host.capture.filter((m) => m.type === 'debug_state');
  const sawIntents = states.some((s) => (s.intents || []).length > 0);
  const sawVotes = states.some((s) => (s.voteTallies || []).some((t) => t.weight > 0));
  const sawChat = host.capture.filter((m) => m.type === 'chat_message').length;
  console.log(
    `[llm-smoke] over after ~${phases} phases. events: vote=${votes} night_action=${nightActs} ` +
      `verdict=${verdicts} | god-view live: intents=${sawIntents} tally=${sawVotes} chat=${sawChat}`,
  );
  if (votes + nightActs === 0)
    throw new Error('bots never submitted a vote or night action — wiring broken');
  host.close();
  console.log('[llm-smoke] PASS — LLM bots played a full game and took real actions.');
  process.exit(0);
}
main().catch((e) => {
  console.error('[llm-smoke] FAIL:', e);
  process.exit(1);
});
