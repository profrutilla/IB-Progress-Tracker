import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadApp, makeEntry } from './harness.mjs';

describe('entry CRUD, undo and data transfer', () => {
  let app;
  let win;
  let doc;

  beforeEach(() => {
    app = loadApp();
    win = app.window;
    doc = app.document;
    win.app.SUBJECTS = ['Biology', 'Chemistry'];
    win.populateSubjectSelects();
    win.resetFormDefaults();
  });

  const fillForm = (values = {}) => {
    const fields = {
      entryType: 'task',
      entrySubject: 'Biology',
      entryTitle: 'Read chapter 4',
      entryWeek: 'Week 2',
      entryDuration: '',
      entryScore: '',
      entryStatus: 'todo',
      entryNotes: '',
      ...values,
    };
    for (const [id, value] of Object.entries(fields)) doc.getElementById(id).value = value;
  };

  const submit = () => win.addEntry({ preventDefault() {} });

  describe('addEntry', () => {
    it('prepends the new entry and resets the form', () => {
      win.app.state = { entries: [makeEntry({ id: 'old' })] };
      fillForm({ entryTitle: '  Read chapter 4  ', entryNotes: '  notes  ' });
      submit();

      const [added] = win.app.state.entries;
      expect(win.app.state.entries).toHaveLength(2);
      expect(added).toMatchObject({
        type: 'task',
        subject: 'Biology',
        title: 'Read chapter 4',
        week: 'Week 2',
        notes: 'notes',
        status: 'todo',
        score: '',
      });
      expect(added.createdAt).toBe(added.updatedAt);
      expect(doc.getElementById('entryTitle').value).toBe('');
    });

    it('ignores a blank title', () => {
      fillForm({ entryTitle: '   ' });
      submit();
      expect(win.app.state.entries).toHaveLength(0);
    });

    it('clamps the score to 0-100', () => {
      fillForm({ entryScore: '140' });
      submit();
      fillForm({ entryScore: '-20' });
      submit();
      expect(win.app.state.entries.map((e) => e.score)).toEqual([0, 100]);
    });

    it('keeps an empty score empty rather than zero', () => {
      fillForm({ entryScore: '  ' });
      submit();
      expect(win.app.state.entries[0].score).toBe('');
    });

    it('is wired to the form submit event', () => {
      fillForm({ entryTitle: 'Via submit' });
      doc.getElementById('entryForm').dispatchEvent(
        new win.Event('submit', { bubbles: true, cancelable: true })
      );
      expect(win.app.state.entries[0].title).toBe('Via submit');
    });
  });

  describe('deleteEntry', () => {
    it('removes only the targeted entry', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })] };
      win.deleteEntry('a');
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['b']);
    });

    it('is a no-op for an unknown id but still snapshots history', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' })] };
      win.deleteEntry('missing');
      expect(win.app.state.entries).toHaveLength(1);
      expect(win.app.undoStack).toHaveLength(1);
    });

    it('is triggered by the card delete button', () => {
      win.app.state = { entries: [makeEntry({ id: 'a', subject: 'Biology' })] };
      win.renderEntries();
      doc.querySelector('[data-delete-id="a"]').click();
      expect(win.app.state.entries).toHaveLength(0);
    });
  });

  describe('markDone and reopenEntry', () => {
    it('marks an entry done and bumps updatedAt', () => {
      const entry = makeEntry({ id: 'a', status: 'todo', updatedAt: 1 });
      win.app.state = { entries: [entry] };
      win.markDone('a');
      expect(entry.status).toBe('done');
      expect(entry.updatedAt).toBeGreaterThan(1);
    });

    it('reopens a done entry as in progress', () => {
      const entry = makeEntry({ id: 'a', status: 'done' });
      win.app.state = { entries: [entry] };
      win.reopenEntry('a');
      expect(entry.status).toBe('progress');
    });

    it('ignores unknown ids', () => {
      win.app.state = { entries: [makeEntry({ id: 'a', status: 'todo' })] };
      win.markDone('nope');
      win.reopenEntry('nope');
      expect(win.app.state.entries[0].status).toBe('todo');
    });

    it('refreshes the open subject modal for the affected subject', () => {
      win.app.state = { entries: [makeEntry({ id: 'a', subject: 'Biology', status: 'todo' })] };
      win.openSubjectModal('Biology');
      expect(doc.getElementById('modalDoneList').textContent).toContain('No completed work yet.');
      win.markDone('a');
      expect(doc.getElementById('modalDoneList').textContent).not.toContain(
        'No completed work yet.'
      );
    });

    it('responds to delegated Done and Reopen buttons', () => {
      win.app.state = { entries: [makeEntry({ id: 'a', subject: 'Biology', status: 'todo' })] };
      win.renderEntries();
      doc.querySelector('[data-done-id="a"]').click();
      expect(win.app.state.entries[0].status).toBe('done');
    });
  });

  describe('undo history', () => {
    it('restores the entries from before the last destructive action', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })] };
      win.deleteEntry('a');
      win.undo();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('stacks multiple actions and unwinds them one at a time', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })] };
      win.deleteEntry('a');
      win.deleteEntry('b');
      win.undo();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['b']);
      win.undo();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('does nothing when the stack is empty', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' })] };
      win.undo();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['a']);
    });

    it('caps the stack at 50 snapshots', () => {
      win.app.state = { entries: [] };
      for (let i = 0; i < 60; i += 1) win.saveHistory();
      expect(win.app.undoStack).toHaveLength(50);
    });

    it('flashes the sync bar and restores the previous message afterwards', () => {
      vi.useFakeTimers();
      try {
        win.setSyncStatus('Local mode. Click Enable Sync to connect.', 'neutral');
        const before = doc.getElementById('syncStatus').innerHTML;
        win.app.state = { entries: [makeEntry({ id: 'a' })] };
        win.deleteEntry('a');
        win.undo();
        expect(doc.getElementById('syncStatus').textContent).toContain('Undo successful');
        vi.advanceTimersByTime(2000);
        expect(doc.getElementById('syncStatus').innerHTML).toBe(before);
      } finally {
        vi.useRealTimers();
      }
    });

    it('undoes on Ctrl+Z but not while typing in an input', () => {
      win.app.state = { entries: [makeEntry({ id: 'a' })] };
      win.deleteEntry('a');

      doc.getElementById('entryTitle').focus();
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(win.app.state.entries).toHaveLength(0);

      doc.getElementById('entryTitle').blur();
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['a']);
    });
  });

  describe('export', () => {
    it('serialises the full state into a downloadable blob', async () => {
      win.app.state = { entries: [makeEntry({ id: 'a', title: 'Exported' })] };
      let downloaded = null;
      const revoked = [];
      win.URL.createObjectURL = (blob) => {
        downloaded = blob;
        return 'blob:fake';
      };
      win.URL.revokeObjectURL = (url) => revoked.push(url);
      // jsdom would try to navigate when the synthetic anchor is clicked.
      win.HTMLAnchorElement.prototype.click = function noop() {};

      win.exportData();

      const text = await new Promise((resolve) => {
        const reader = new win.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(downloaded);
      });
      expect(JSON.parse(text).entries[0].title).toBe('Exported');
      expect(revoked).toEqual(['blob:fake']);
    });
  });

  describe('import', () => {
    const importFile = (contents) =>
      new Promise((resolve) => {
        win.alert = (msg) => resolve(msg);
        win.importData(new win.Blob([contents], { type: 'application/json' }));
      });

    it('replaces state with the imported entries and defaults duration', async () => {
      const message = await importFile(
        JSON.stringify({ entries: [{ id: 'x', title: 'Imported', subject: 'Biology' }] })
      );
      expect(message).toBe('Data imported successfully.');
      expect(win.app.state.entries).toEqual([
        { duration: '', id: 'x', title: 'Imported', subject: 'Biology' },
      ]);
    });

    it('keeps an explicit duration from the backup', async () => {
      await importFile(JSON.stringify({ entries: [{ id: 'x', duration: '45 min' }] }));
      expect(win.app.state.entries[0].duration).toBe('45 min');
    });

    it('rejects malformed JSON without touching state', async () => {
      win.app.state = { entries: [makeEntry({ id: 'keep' })] };
      const message = await importFile('not json');
      expect(message).toBe('That file is not a valid backup.');
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['keep']);
    });

    it('rejects JSON without an entries array', async () => {
      win.app.state = { entries: [makeEntry({ id: 'keep' })] };
      const message = await importFile(JSON.stringify({ entries: 'nope' }));
      expect(message).toBe('That file is not a valid backup.');
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['keep']);
    });
  });

  describe('seedDemo', () => {
    it('loads demo entries when the tracker is empty', () => {
      win.seedDemo();
      expect(win.app.state.entries).toHaveLength(win.app.demoEntries.length);
    });

    it('asks before replacing existing entries and honours a refusal', () => {
      win.app.state = { entries: [makeEntry({ id: 'mine' })] };
      win.__confirmAnswer = false;
      win.seedDemo();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(['mine']);

      win.__confirmAnswer = true;
      win.seedDemo();
      expect(win.app.state.entries).toHaveLength(win.app.demoEntries.length);
    });

    it('clones the demo data so the template is not mutated', () => {
      win.seedDemo();
      win.app.state.entries[0].title = 'changed';
      expect(win.app.demoEntries[0].title).not.toBe('changed');
    });
  });
});
