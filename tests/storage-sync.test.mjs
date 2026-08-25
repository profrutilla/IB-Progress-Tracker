import { beforeEach, describe, expect, it } from 'vitest';
import { loadApp, makeEntry, signIn } from './harness.mjs';

const TRACKER_DOC = 'users/user-1/trackers/main';

describe('local storage and cloud sync', () => {
  let app;
  let win;
  let doc;

  beforeEach(() => {
    app = loadApp();
    win = app.window;
    doc = app.document;
    win.localStorage.clear();
  });

  describe('localStorageKey', () => {
    it('uses the shared key while signed out', () => {
      expect(win.localStorageKey()).toBe(win.app.STORAGE_KEY);
    });

    it('namespaces the key per user once signed in', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      expect(win.localStorageKey()).toBe(`${win.app.STORAGE_KEY}-user-1`);
    });
  });

  describe('loadLocalState', () => {
    it('returns an empty tracker when nothing is cached', () => {
      expect(win.loadLocalState()).toEqual({ entries: [] });
    });

    it('reads a cached tracker', () => {
      win.localStorage.setItem(
        win.app.STORAGE_KEY,
        JSON.stringify({ entries: [{ id: 'a', title: 'Cached' }] })
      );
      expect(win.loadLocalState().entries[0].title).toBe('Cached');
    });

    it('recovers from corrupt JSON', () => {
      win.localStorage.setItem(win.app.STORAGE_KEY, '{not json');
      expect(win.loadLocalState()).toEqual({ entries: [] });
    });

    it('ignores a cached payload whose entries are not an array', () => {
      win.localStorage.setItem(win.app.STORAGE_KEY, JSON.stringify({ entries: { a: 1 } }));
      expect(win.loadLocalState()).toEqual({ entries: [] });
    });
  });

  describe('saveState', () => {
    it('always writes the local cache', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' })] };
      win.saveState();
      expect(JSON.parse(win.localStorage.getItem(win.app.STORAGE_KEY)).entries[0].id).toBe('a');
    });

    it('does not push to the cloud while signed out', () => {
      win.saveState();
      expect(app.firestore.docs.has(TRACKER_DOC)).toBe(false);
    });

    it('pushes to the cloud when sync is enabled', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      win.app.state = { entries: [makeEntry({ id: 'cloud' })] };
      win.saveState();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.firestore.docs.get(TRACKER_DOC).entries[0].id).toBe('cloud');
    });

    it('falls back to an offline message when the cloud push fails', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      win.trackerDocRef = () => ({
        set: () => Promise.reject(new Error('offline')),
      });
      win.saveState();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(doc.getElementById('syncStatus').textContent).toContain('changes saved locally');
    });
  });

  describe('pushStateToCloud', () => {
    it('writes entries plus a server timestamp and mirrors the local cache', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      win.app.state = { entries: [makeEntry({ id: 'a' })] };
      await win.pushStateToCloud();
      expect(app.firestore.docs.get(TRACKER_DOC)).toMatchObject({
        updatedAt: '<<serverTimestamp>>',
      });
      expect(app.firestore.docs.get(TRACKER_DOC).entries[0].id).toBe('a');
      expect(win.localStorage.getItem(win.localStorageKey())).toContain('"id":"a"');
    });

    it('is a no-op when nobody is signed in', async () => {
      await win.pushStateToCloud();
      expect(app.firestore.docs.has(TRACKER_DOC)).toBe(false);
    });
  });

  describe('cloud snapshots', () => {
    beforeEach(async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
    });

    it('seeds the cloud from local data on the very first sync', async () => {
      win.app.state = { entries: [makeEntry({ id: 'local-only' })] };
      app.firestore.emitSnapshot(TRACKER_DOC, { exists: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.firestore.docs.get(TRACKER_DOC).entries[0].id).toBe('local-only');
      expect(doc.getElementById('syncHeaderLabel').textContent).toBe('Live');
    });

    it('reports an error when the initial push fails', async () => {
      win.trackerDocRef = () => ({ set: () => Promise.reject(new Error('quota')) });
      app.firestore.emitSnapshot(TRACKER_DOC, { exists: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(doc.getElementById('syncStatus').textContent).toContain('Could not save to cloud: quota');
      expect(doc.getElementById('syncHeaderLabel').textContent).toBe('Error');
    });

    it('keeps local state for snapshots echoing this device’s own write', () => {
      win.app.state = { entries: [makeEntry({ id: 'mine' })] };
      app.firestore.emitSnapshot(TRACKER_DOC, {
        hasPendingWrites: true,
        data: { entries: [] },
      });
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['mine']);
      expect(doc.getElementById('syncHeaderLabel').textContent).toBe('Live');
    });

    it('replaces local state with cloud data from another device', () => {
      win.app.state = { entries: [makeEntry({ id: 'stale' })] };
      app.firestore.emitSnapshot(TRACKER_DOC, {
        data: { entries: [{ id: 'from-phone', subject: 'Biology', title: 'Phone entry' }] },
      });
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['from-phone']);
      expect(win.localStorage.getItem(win.localStorageKey())).toContain('from-phone');
    });

    it('treats a malformed cloud payload as an empty tracker', () => {
      win.app.state = { entries: [makeEntry({ id: 'stale' })] };
      app.firestore.emitSnapshot(TRACKER_DOC, { data: { entries: 'oops' } });
      expect(win.app.state.entries).toEqual([]);
    });

    it('surfaces listener errors', () => {
      app.firestore.emitSnapshotError(TRACKER_DOC, new Error('permission denied'));
      expect(doc.getElementById('syncStatus').textContent).toContain(
        'Sync error: permission denied'
      );
      expect(doc.getElementById('syncHeaderLabel').textContent).toBe('Error');
    });
  });

  describe('enableCloudSync / disableCloudSync', () => {
    it('does nothing without a signed-in user', async () => {
      await win.enableCloudSync();
      expect(win.app.sync.enabled).toBe(false);
      expect(app.firestore.hasListener(TRACKER_DOC)).toBe(false);
    });

    it('replaces an existing listener rather than stacking them', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      const first = win.app.sync.unsub;
      await win.enableCloudSync();
      expect(win.app.sync.unsub).not.toBe(first);
      expect(app.firestore.hasListener(TRACKER_DOC)).toBe(true);
    });

    it('tears down the listener and shows local mode when disabled', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      win.disableCloudSync();
      expect(win.app.sync.enabled).toBe(false);
      expect(win.app.sync.unsub).toBeNull();
      expect(app.firestore.hasListener(TRACKER_DOC)).toBe(false);
      expect(doc.getElementById('syncStatus').textContent).toContain('Local mode');
      expect(doc.getElementById('forcePushBtn').classList.contains('hidden')).toBe(true);
    });
  });

  describe('sync UI', () => {
    it('setSyncStatus applies the palette for the tone', () => {
      win.setSyncStatus('all good', 'success');
      const el = doc.getElementById('syncStatus');
      expect(el.className).toContain('emerald');
      expect(el.textContent).toContain('all good');
      expect(el.innerHTML).toContain('sync-dot live');
    });

    it('setSyncStatus falls back to neutral for an unknown tone', () => {
      win.setSyncStatus('hmm', 'chartreuse');
      expect(doc.getElementById('syncStatus').className).toContain('bg-white/5');
      expect(doc.getElementById('syncStatus').innerHTML).toContain('sync-dot offline');
    });

    it('setSyncStatus escapes the message', () => {
      win.setSyncStatus('<b>oops</b>');
      expect(doc.getElementById('syncStatus').innerHTML).toContain('&lt;b&gt;oops&lt;/b&gt;');
    });

    it('setHeaderSync updates the dot and label', () => {
      win.setHeaderSync('connecting', 'Connecting…');
      expect(doc.getElementById('syncHeaderDot').className).toBe('sync-dot connecting');
      expect(doc.getElementById('syncHeaderLabel').textContent).toBe('Connecting…');
    });

    it('setHeaderSync falls back to offline for an unknown state', () => {
      win.setHeaderSync('weird', 'Hmm');
      expect(doc.getElementById('syncHeaderDot').className).toBe('sync-dot offline');
    });

    it('toggles the sync panel open and closed', () => {
      const body = doc.getElementById('syncPanelBody');
      doc.getElementById('syncToggleBtn').click();
      expect(body.classList.contains('collapsed')).toBe(false);
      doc.getElementById('syncToggleBtn').click();
      expect(body.classList.contains('collapsed')).toBe(true);
    });

    it('force push reports success and failure', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);

      doc.getElementById('forcePushBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(doc.getElementById('syncStatus').textContent).toContain('All local data pushed');

      win.trackerDocRef = () => ({ set: () => Promise.reject(new Error('nope')) });
      doc.getElementById('forcePushBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(doc.getElementById('syncStatus').textContent).toContain('Force push failed: nope');
    });

    it('force push does nothing while sync is disabled', async () => {
      win.setSyncStatus('untouched');
      doc.getElementById('forcePushBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(doc.getElementById('syncStatus').textContent).toContain('untouched');
    });
  });
});
