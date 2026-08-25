import { beforeEach, describe, expect, it } from 'vitest';
import { loadApp, makeEntry } from './harness.mjs';

describe('metrics and filtering', () => {
  let app;
  let win;
  let doc;

  beforeEach(() => {
    app = loadApp();
    win = app.window;
    doc = app.document;
    win.app.SUBJECTS = ['Biology', 'Chemistry'];
    win.populateSubjectSelects();
  });

  describe('getSubjectMetrics', () => {
    it('returns zeroed metrics for a subject with no entries', () => {
      expect(win.getSubjectMetrics('Biology')).toMatchObject({
        completed: 0,
        total: 0,
        percent: 0,
        syllabusPercent: 0,
        averageScore: null,
      });
    });

    it('counts completion, task split and paper average', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', type: 'task', status: 'done' }),
          makeEntry({ subject: 'Biology', type: 'task', status: 'progress' }),
          makeEntry({ subject: 'Biology', type: 'syllabus', status: 'done' }),
          makeEntry({ subject: 'Biology', type: 'syllabus', status: 'todo' }),
          makeEntry({ subject: 'Biology', type: 'paper', status: 'done', score: 80 }),
          makeEntry({ subject: 'Biology', type: 'paper', status: 'progress', score: 60 }),
          makeEntry({ subject: 'Chemistry', type: 'task', status: 'done' }),
        ],
      };
      expect(win.getSubjectMetrics('Biology')).toEqual({
        completed: 3,
        total: 6,
        percent: 50,
        taskDone: 1,
        taskInProgress: 1,
        syllabusPercent: 50,
        papersDone: 1,
        averageScore: 70,
        inProgress: 3,
        done: 3,
      });
    });

    it('rounds percentages and averages to whole numbers', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', status: 'done' }),
          makeEntry({ subject: 'Biology', status: 'todo' }),
          makeEntry({ subject: 'Biology', status: 'todo' }),
          makeEntry({ subject: 'Biology', type: 'paper', score: 71 }),
          makeEntry({ subject: 'Biology', type: 'paper', score: 72 }),
          makeEntry({ subject: 'Biology', type: 'paper', score: 74 }),
        ],
      };
      const m = win.getSubjectMetrics('Biology');
      expect(m.percent).toBe(17);
      expect(m.averageScore).toBe(72);
    });

    it('treats a blank paper score as zero (documents current behaviour)', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', type: 'paper', score: 90 }),
          makeEntry({ subject: 'Biology', type: 'paper', score: '' }),
        ],
      };
      expect(win.getSubjectMetrics('Biology').averageScore).toBe(45);
    });

    it('ignores non-numeric and negative scores', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', type: 'paper', score: 'n/a' }),
          makeEntry({ subject: 'Biology', type: 'paper', score: -5 }),
          makeEntry({ subject: 'Biology', type: 'paper', score: 50 }),
        ],
      };
      expect(win.getSubjectMetrics('Biology').averageScore).toBe(50);
    });
  });

  describe('filteredEntries', () => {
    const seed = (win_) => {
      win_.app.state = {
        entries: [
          makeEntry({ id: 'bio-task', subject: 'Biology', type: 'task', createdAt: 3 }),
          makeEntry({ id: 'bio-paper', subject: 'Biology', type: 'paper', createdAt: 1 }),
          makeEntry({ id: 'chem-task', subject: 'Chemistry', type: 'task', createdAt: 2 }),
          makeEntry({ id: 'dropped', subject: 'Physics', type: 'task', createdAt: 4 }),
        ],
      };
    };

    it('drops entries outside the active subject list and sorts newest first', () => {
      seed(win);
      expect(win.filteredEntries().map((e) => e.id)).toEqual(['bio-task', 'chem-task', 'bio-paper']);
    });

    it('keeps every subject when the user has none selected', () => {
      win.app.SUBJECTS = [];
      seed(win);
      expect(win.filteredEntries().map((e) => e.id)).toEqual([
        'dropped',
        'bio-task',
        'chem-task',
        'bio-paper',
      ]);
    });

    it('applies the type filter', () => {
      seed(win);
      doc.getElementById('filterType').value = 'paper';
      expect(win.filteredEntries().map((e) => e.id)).toEqual(['bio-paper']);
    });

    it('applies the subject filter', () => {
      seed(win);
      doc.getElementById('filterSubject').value = 'Chemistry';
      expect(win.filteredEntries().map((e) => e.id)).toEqual(['chem-task']);
    });

    it('does not mutate the underlying state array', () => {
      seed(win);
      const before = win.app.state.entries.map((e) => e.id);
      win.filteredEntries();
      expect(win.app.state.entries.map((e) => e.id)).toEqual(before);
    });
  });

  describe('renderSummary', () => {
    it('shows placeholders when there is nothing logged', () => {
      win.renderSummary();
      expect(doc.getElementById('summaryTasksDone').textContent).toBe('0');
      expect(doc.getElementById('summarySyllabusPercent').textContent).toBe('0%');
      expect(doc.getElementById('summaryAverageScore').textContent).toBe('—');
    });

    it('aggregates only entries from the active subjects', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', type: 'task', status: 'done' }),
          makeEntry({ subject: 'Biology', type: 'task', status: 'todo' }),
          makeEntry({ subject: 'Biology', type: 'syllabus', status: 'done' }),
          makeEntry({ subject: 'Chemistry', type: 'paper', status: 'done', score: 60 }),
          makeEntry({ subject: 'Chemistry', type: 'paper', status: 'todo', score: 80 }),
          makeEntry({ subject: 'Physics', type: 'task', status: 'done' }),
        ],
      };
      win.renderSummary();
      expect(doc.getElementById('summaryTasksDone').textContent).toBe('1');
      expect(doc.getElementById('summaryTasksTotal').textContent).toBe('of 2 tasks');
      expect(doc.getElementById('summarySyllabusPercent').textContent).toBe('100%');
      expect(doc.getElementById('summarySyllabusCount').textContent).toBe('1 of 1 items complete');
      expect(doc.getElementById('summaryPapersDone').textContent).toBe('1');
      expect(doc.getElementById('summaryPapersTotal').textContent).toBe('of 2 papers logged');
      expect(doc.getElementById('summaryAverageScore').textContent).toBe('70%');
    });
  });

  describe('renderEntries', () => {
    it('splits entries into in-progress and done buckets with counts', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', status: 'todo' }),
          makeEntry({ subject: 'Biology', status: 'progress' }),
          makeEntry({ subject: 'Biology', status: 'done' }),
        ],
      };
      win.renderEntries();
      expect(doc.getElementById('inProgressCount').textContent).toBe('2');
      expect(doc.getElementById('doneCount').textContent).toBe('1');
      expect(doc.querySelectorAll('#entriesInProgress [data-delete-id]')).toHaveLength(2);
      expect(doc.querySelectorAll('#entriesDone [data-delete-id]')).toHaveLength(1);
    });

    it('renders empty states for both buckets', () => {
      win.renderEntries();
      expect(doc.getElementById('entriesInProgress').textContent).toContain(
        'No in-progress entries'
      );
      expect(doc.getElementById('entriesDone').textContent).toContain('No done entries');
    });
  });

  describe('renderSubjectStats', () => {
    it('renders one clickable card per selected subject', () => {
      win.app.state = { entries: [makeEntry({ subject: 'Biology', status: 'done' })] };
      win.renderSubjectStats();
      const cards = doc.querySelectorAll('[data-open-subject]');
      expect([...cards].map((c) => c.dataset.openSubject)).toEqual(['Biology', 'Chemistry']);
      expect(cards[0].textContent).toContain('1/1 items complete');
      expect(cards[0].textContent).toContain('100%');
    });

    it('opens the subject modal when a card is clicked', () => {
      win.app.state = { entries: [makeEntry({ subject: 'Biology', title: 'Osmosis lab' })] };
      win.renderSubjectStats();
      doc.querySelector('[data-open-subject="Biology"]').click();
      expect(doc.getElementById('subjectModal').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('modalSubjectTitle').textContent).toBe('Biology');
      expect(doc.getElementById('modalInProgressList').textContent).toContain('Osmosis lab');
    });
  });

  describe('subject modal', () => {
    it('lists in-progress and done work separately with summary cards', () => {
      win.app.state = {
        entries: [
          makeEntry({ subject: 'Biology', title: 'Open item', status: 'progress' }),
          makeEntry({ subject: 'Biology', title: 'Closed item', status: 'done' }),
          makeEntry({ subject: 'Biology', type: 'paper', status: 'done', score: 88 }),
        ],
      };
      win.openSubjectModal('Biology');
      expect(doc.getElementById('modalInProgressList').textContent).toContain('Open item');
      expect(doc.getElementById('modalDoneList').textContent).toContain('Closed item');
      expect(doc.getElementById('modalSummaryCards').textContent).toContain('88%');
      expect(doc.body.classList.contains('modal-open')).toBe(true);
    });

    it('closes on the close button, backdrop click and Escape', () => {
      const modal = doc.getElementById('subjectModal');

      win.openSubjectModal('Biology');
      doc.getElementById('closeModalBtn').click();
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(doc.body.classList.contains('modal-open')).toBe(false);

      win.openSubjectModal('Biology');
      modal.click();
      expect(modal.classList.contains('hidden')).toBe(true);

      win.openSubjectModal('Biology');
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
      expect(modal.classList.contains('hidden')).toBe(true);
    });
  });

  describe('form defaults', () => {
    it('populates both subject dropdowns from the active subjects', () => {
      expect([...doc.getElementById('entrySubject').options].map((o) => o.text)).toEqual([
        'Biology',
        'Chemistry',
      ]);
      expect([...doc.getElementById('filterSubject').options].map((o) => o.value)).toEqual([
        'all',
        'Biology',
        'Chemistry',
      ]);
    });

    it('falls back to the full catalogue when no subjects are selected', () => {
      win.app.SUBJECTS = [];
      win.populateSubjectSelects();
      expect(doc.getElementById('entrySubject').options).toHaveLength(
        win.app.ALL_SUBJECTS.length
      );
    });

    it('resetFormDefaults restores task/todo and the first subject', () => {
      doc.getElementById('entryType').value = 'paper';
      doc.getElementById('entryStatus').value = 'done';
      doc.getElementById('filterSubject').value = 'Chemistry';
      win.resetFormDefaults();
      expect(doc.getElementById('entryType').value).toBe('task');
      expect(doc.getElementById('entryStatus').value).toBe('todo');
      expect(doc.getElementById('entrySubject').value).toBe('Biology');
      expect(doc.getElementById('filterSubject').value).toBe('all');
    });
  });
});
