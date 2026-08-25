import { beforeEach, describe, expect, it } from 'vitest';
import { loadApp, signIn } from './harness.mjs';

const PROFILE_DOC = 'users/user-1/profile/settings';

describe('subject picker', () => {
  let app;
  let win;
  let doc;

  beforeEach(() => {
    app = loadApp();
    win = app.window;
    doc = app.document;
    win.localStorage.clear();
  });

  describe('openSubjectPicker', () => {
    it('renders a chip for every subject in every IB group', () => {
      win.openSubjectPicker();
      const chips = doc.querySelectorAll('#subjectPickerGroups .subject-chip');
      expect(chips).toHaveLength(win.app.ALL_SUBJECTS.length);
      expect(doc.querySelectorAll('#subjectPickerGroups h3')).toHaveLength(
        win.app.IB_GROUPS.length
      );
    });

    it('pre-selects the current subjects', () => {
      win.app.SUBJECTS = ['Biology', 'Physics'];
      win.openSubjectPicker();
      const selected = [...doc.querySelectorAll('.subject-chip.selected')].map(
        (c) => c.dataset.subject
      );
      expect(selected).toEqual(['Biology', 'Physics']);
      expect(doc.getElementById('subjectPickerCount').textContent).toBe('2 subjects selected');
    });

    it('hides the close button and greets first-time users', () => {
      win.openSubjectPicker(true);
      expect(doc.getElementById('closeSubjectPickerBtn').classList.contains('hidden')).toBe(true);
      expect(doc.getElementById('subjectPickerTitle').textContent).toContain('Welcome');
    });

    it('shows the close button for returning users', () => {
      win.openSubjectPicker(false);
      expect(doc.getElementById('closeSubjectPickerBtn').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('subjectPickerTitle').textContent).toBe('Edit My Subjects');
    });

    it('toggles chips and keeps the counter and save button in step', () => {
      win.openSubjectPicker();
      const save = doc.getElementById('saveSubjectsBtn');
      expect(save.disabled).toBe(true);
      expect(doc.getElementById('subjectPickerCount').textContent).toBe('0 subjects selected');

      const chip = doc.querySelector('[data-subject="Biology"]');
      chip.click();
      expect(chip.classList.contains('selected')).toBe(true);
      expect(doc.getElementById('subjectPickerCount').textContent).toBe('1 subject selected');
      expect(save.disabled).toBe(false);

      chip.click();
      expect(chip.classList.contains('selected')).toBe(false);
      expect(save.disabled).toBe(true);
    });
  });

  describe('saving subjects', () => {
    it('stores the selection in IB_GROUPS order, in Firestore and locally', async () => {
      await signIn(app); // no profile yet → picker opens
      doc.querySelector('[data-subject="Physics"]').click();
      doc.querySelector('[data-subject="Biology"]').click();
      doc.getElementById('saveSubjectsBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(win.app.SUBJECTS).toEqual(['Biology', 'Physics']);
      expect(app.firestore.docs.get(PROFILE_DOC).subjects).toEqual(['Biology', 'Physics']);
      expect(
        JSON.parse(win.localStorage.getItem(`${win.localStorageKey()}-subjects`))
      ).toEqual(['Biology', 'Physics']);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(true);
    });

    it('ignores the save button when nothing is selected', async () => {
      await signIn(app);
      doc.getElementById('saveSubjectsBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(win.app.SUBJECTS).toEqual([]);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(false);
    });

    it('still caches locally when the Firestore write fails', async () => {
      await signIn(app);
      win.userProfileRef = () => ({ set: () => Promise.reject(new Error('offline')) });
      await win.saveUserSubjects(['Biology']);
      expect(win.app.SUBJECTS).toEqual(['Biology']);
      expect(
        JSON.parse(win.localStorage.getItem(`${win.localStorageKey()}-subjects`))
      ).toEqual(['Biology']);
    });

    it('refreshes the subject dropdowns after saving', async () => {
      await signIn(app);
      await win.saveUserSubjects(['Biology', 'Chemistry']);
      expect([...doc.getElementById('entrySubject').options].map((o) => o.text)).toEqual([
        'Biology',
        'Chemistry',
      ]);
    });
  });

  describe('loadUserSubjects', () => {
    it('uses the saved profile and leaves the picker closed', async () => {
      app.firestore.docs.set(PROFILE_DOC, { subjects: ['Chemistry'] });
      await signIn(app);
      expect(win.app.SUBJECTS).toEqual(['Chemistry']);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(true);
    });

    it('opens the picker for a profile with an empty subject list', async () => {
      app.firestore.docs.set(PROFILE_DOC, { subjects: [] });
      await signIn(app);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(false);
    });

    it('falls back to the local cache when Firestore is unreachable', async () => {
      win.localStorage.setItem(
        `${win.app.STORAGE_KEY}-user-1-subjects`,
        JSON.stringify(['Physics'])
      );
      win.userProfileRef = () => ({ get: () => Promise.reject(new Error('offline')) });
      await signIn(app);
      expect(win.app.SUBJECTS).toEqual(['Physics']);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(true);
    });

    it('opens the picker when neither cloud nor cache has subjects', async () => {
      win.userProfileRef = () => ({ get: () => Promise.reject(new Error('offline')) });
      await signIn(app);
      expect(win.app.SUBJECTS).toEqual([]);
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(false);
    });
  });

  describe('closing the picker', () => {
    it('closes via the close button and clears the modal-open lock', () => {
      win.openSubjectPicker(false);
      expect(doc.body.classList.contains('modal-open')).toBe(true);
      doc.getElementById('closeSubjectPickerBtn').click();
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(true);
      expect(doc.body.classList.contains('modal-open')).toBe(false);
    });

    it('reopens from the My Subjects header button', () => {
      doc.getElementById('mySubjectsBtn').click();
      expect(doc.getElementById('subjectPickerModal').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('closeSubjectPickerBtn').classList.contains('hidden')).toBe(false);
    });
  });
});
