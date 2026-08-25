import { beforeEach, describe, expect, it } from 'vitest';
import { loadApp, makeEntry } from './harness.mjs';

describe('render helpers', () => {
  let win;

  beforeEach(() => {
    win = loadApp().window;
  });

  describe('escapeHtml', () => {
    it('escapes every HTML-significant character', () => {
      expect(win.escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
        '&lt;img src=&quot;x&quot; onerror=&#039;y&#039;&gt;&amp;'
      );
    });

    it('coerces non-string values', () => {
      expect(win.escapeHtml(42)).toBe('42');
      expect(win.escapeHtml(null)).toBe('null');
      expect(win.escapeHtml(undefined)).toBe('undefined');
    });

    it('leaves safe text untouched', () => {
      expect(win.escapeHtml('Mathematics: Analysis & Approaches')).toBe(
        'Mathematics: Analysis &amp; Approaches'
      );
    });
  });

  describe('statusBadge', () => {
    it('maps done and progress to their own palettes', () => {
      expect(win.statusBadge('done')).toContain('emerald');
      expect(win.statusBadge('progress')).toContain('amber');
    });

    it('falls back to the neutral palette for anything else', () => {
      expect(win.statusBadge('todo')).toContain('slate');
      expect(win.statusBadge(undefined)).toContain('slate');
    });
  });

  describe('typeBadge', () => {
    it.each([
      ['task', 'cyan'],
      ['paper', 'violet'],
      ['syllabus', 'indigo'],
      ['focus', 'fuchsia'],
      ['revision', 'sky'],
      ['ia', 'orange'],
    ])('maps %s to the %s palette', (type, colour) => {
      expect(win.typeBadge(type)).toContain(colour);
    });

    it('falls back to rose for unknown types', () => {
      expect(win.typeBadge('ee')).toContain('rose');
      expect(win.typeBadge('nonsense')).toContain('rose');
    });
  });

  describe('prettyType', () => {
    it('resolves known type codes to labels', () => {
      expect(win.prettyType('task')).toBe('Weekly Task');
      expect(win.prettyType('ee')).toBe('EE Work');
    });

    it('returns the raw code when unmapped', () => {
      expect(win.prettyType('mystery')).toBe('mystery');
    });
  });

  describe('renderEmptyState', () => {
    it('embeds the supplied message', () => {
      expect(win.renderEmptyState('Nothing here')).toContain('Nothing here');
    });
  });

  describe('renderEntryCard', () => {
    it('renders badges, title and delete affordance', () => {
      const html = win.renderEntryCard(
        makeEntry({ id: 'abc', type: 'paper', status: 'done', title: 'Mock Paper 1' })
      );
      expect(html).toContain('Past Paper');
      expect(html).toContain('Mock Paper 1');
      expect(html).toContain('data-delete-id="abc"');
    });

    it('only offers the DONE button when asked', () => {
      const entry = makeEntry({ id: 'abc' });
      expect(win.renderEntryCard(entry, true)).toContain('data-done-id="abc"');
      expect(win.renderEntryCard(entry, false)).not.toContain('data-done-id');
    });

    it('escapes user-supplied fields', () => {
      const html = win.renderEntryCard(
        makeEntry({ title: '<script>alert(1)</script>', notes: '"quoted"', week: '<b>' })
      );
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&quot;quoted&quot;');
    });

    it('omits optional metadata that is absent', () => {
      const html = win.renderEntryCard(makeEntry({ week: '', duration: '', score: '', notes: '' }));
      expect(html).not.toContain('calendar-range');
      expect(html).not.toContain('timer');
      expect(html).not.toContain('percent');
    });

    it('shows the score when present, including zero', () => {
      expect(win.renderEntryCard(makeEntry({ score: 0 }))).toContain('0%');
      expect(win.renderEntryCard(makeEntry({ score: 91 }))).toContain('91%');
      expect(win.renderEntryCard(makeEntry({ score: null }))).not.toContain('percent');
    });
  });

  describe('renderModalList', () => {
    it('returns the empty placeholder for an empty list', () => {
      expect(win.renderModalList([], 'No work yet.')).toContain('No work yet.');
    });

    it('offers Done for open entries and Reopen for finished ones', () => {
      const html = win.renderModalList([
        makeEntry({ id: 'open', status: 'progress' }),
        makeEntry({ id: 'closed', status: 'done' }),
      ]);
      expect(html).toContain('data-done-id="open"');
      expect(html).toContain('data-reopen-id="closed"');
    });
  });
});
