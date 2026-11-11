// Ported from the original desktop updater handoff tests; KTeam owns this copy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UpdaterHandoffStateMachine, type UpdaterHandoffAdapter } from '../desktop/updater-handoff.js';

/** Mimics MacUpdater: not-ready path registers an anonymous listener, then returns. */
function macAdapter(behaviour: { listenerRegistered?: () => void; throwAfterListener?: Error; preflightError?: Error } = {}): UpdaterHandoffAdapter {
  const adapter: UpdaterHandoffAdapter = {
    platformClass: 'mac',
    invokeWrapper: () => {
      behaviour.listenerRegistered?.();
      if (behaviour.throwAfterListener) throw behaviour.throwAfterListener;
    },
  };
  if (behaviour.preflightError) adapter.preflight = () => { throw behaviour.preflightError; };
  return adapter;
}

/** Mimics BaseUpdater: a synchronous rejection is dispatched in the same stack. */
function baseAdapter(syncError?: Error): UpdaterHandoffAdapter {
  return { platformClass: 'base', invokeWrapper: () => (syncError ? { syncError } : undefined) };
}

describe('updater handoff — macOS branch', () => {
  it('stays pending after the wrapper returns and keeps the runtime usable', () => {
    let listeners = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({ listenerRegistered: () => { listeners += 1; } }));
    assert.deepEqual(sm.begin(), { status: 'pending' });
    assert.deepEqual(sm.projection(), { status: 'install_handoff_pending' });
    assert.equal(listeners, 1);
  });

  it('never calls the wrapper twice for one pending attempt', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({ listenerRegistered: () => { calls += 1; } }));
    sm.begin();
    assert.deepEqual(sm.begin(), { status: 'already_pending' });
    assert.deepEqual(sm.begin(), { status: 'already_pending' });
    assert.equal(calls, 1);
  });

  it('becomes pending_error_sticky when checkForUpdates throws after the listener', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({
      listenerRegistered: () => { calls += 1; },
      throwAfterListener: new Error('checkForUpdates exploded'),
    }));
    assert.deepEqual(sm.begin(), { status: 'pending_error_sticky', diagnostic: 'checkForUpdates exploded' });
    // Sticky: repeated requests must not register a second listener or retry.
    assert.deepEqual(sm.begin(), { status: 'pending_error_sticky', diagnostic: 'checkForUpdates exploded' });
    assert.equal(calls, 1);
    // The app stays usable and still reports pending to the UI.
    assert.equal(sm.projection().status, 'install_handoff_pending');
  });

  it('allows a retry only when the pre-wrapper self-check fails', () => {
    let calls = 0;
    let updateDownloaded = false;
    const sm = new UpdaterHandoffStateMachine({
      platformClass: 'mac',
      preflight: () => { if (!updateDownloaded) throw new Error('no downloaded update'); },
      invokeWrapper: () => { calls += 1; },
    });
    assert.deepEqual(sm.begin(), { status: 'rejected_sync', diagnostic: 'no downloaded update' });
    assert.equal(calls, 0);
    updateDownloaded = true;
    assert.deepEqual(sm.begin(), { status: 'pending' });
    assert.equal(calls, 1);
  });

  it('rejects before the wrapper when the adapter preflight fails', () => {
    const sm = new UpdaterHandoffStateMachine(macAdapter({ preflightError: new Error('not downloaded') }));
    assert.deepEqual(sm.begin(), { status: 'rejected_sync', diagnostic: 'not downloaded' });
    assert.deepEqual(sm.projection(), { status: 'install_failed', diagnostic: 'not downloaded' });
  });
});

describe('updater handoff — Base/Nsis branch', () => {
  it('returns to idle on a synchronously attributed error and allows a retry', () => {
    let attempt = 0;
    const sm = new UpdaterHandoffStateMachine({
      platformClass: 'base',
      invokeWrapper: () => {
        attempt += 1;
        return attempt === 1 ? { syncError: new Error('install returned false') } : undefined;
      },
    });
    assert.deepEqual(sm.begin(), { status: 'rejected_sync', diagnostic: 'install returned false' });
    assert.deepEqual(sm.projection(), { status: 'install_failed', diagnostic: 'install returned false' });
    assert.deepEqual(sm.begin(), { status: 'pending' });
    assert.equal(attempt, 2);
  });

  it('keeps pending after a late async spawn error (Nsis already queued app.quit)', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine({ platformClass: 'base', invokeWrapper: () => { calls += 1; } });
    sm.begin();
    sm.observeAsyncUpdaterError(new Error('spawnLog failed'));
    assert.equal(sm.hasPendingIntent, true);
    assert.deepEqual(sm.projection(), { status: 'install_handoff_pending', diagnostic: 'spawnLog failed' });
    // No second wrapper call is permitted for the same intent.
    assert.deepEqual(sm.begin(), { status: 'pending_error_sticky', diagnostic: 'spawnLog failed' });
    assert.equal(calls, 1);
  });

  it('ignores unrelated background updater errors when idle', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());
    sm.observeAsyncUpdaterError(new Error('4h check failed'));
    assert.deepEqual(sm.snapshot(), { kind: 'idle' });
  });
});

describe('updater handoff — commit on real before-quit', () => {
  it('commits exactly once and reports the attempt id', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());
    sm.begin();
    assert.deepEqual(sm.commitHandoffOnBeforeQuit(), { committed: true, attemptId: 1 });
    assert.deepEqual(sm.commitHandoffOnBeforeQuit(), { committed: false, attemptId: 1 });
    assert.deepEqual(sm.projection(), { status: 'install_handed_off' });
  });

  it('commits a sticky pending attempt too, and late errors cannot roll it back', () => {
    const sm = new UpdaterHandoffStateMachine(macAdapter({ throwAfterListener: new Error('sync throw') }));
    sm.begin();
    assert.deepEqual(sm.commitHandoffOnBeforeQuit(), { committed: true, attemptId: 1 });
    sm.observeAsyncUpdaterError(new Error('late error'));
    assert.deepEqual(sm.snapshot(), { kind: 'handed_off', attemptId: 1 });
  });

  it('a normal quit without an install intent commits nothing', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());
    assert.deepEqual(sm.commitHandoffOnBeforeQuit(), { committed: false, attemptId: null });
  });
});
