import { beforeEach, describe, expect, it } from 'vitest';
import { loadApp, signIn } from './harness.mjs';

describe('auth screen', () => {
  let app;
  let win;
  let doc;

  beforeEach(() => {
    app = loadApp();
    win = app.window;
    doc = app.document;
    app.auth.nextError = null;
  });

  describe('friendlyAuthError', () => {
    it.each([
      ['auth/user-not-found', 'No account found with that email.'],
      ['auth/wrong-password', 'Incorrect password. Please try again.'],
      ['auth/invalid-email', 'Please enter a valid email address.'],
      ['auth/email-already-in-use', 'An account with this email already exists.'],
      ['auth/weak-password', 'Password must be at least 6 characters.'],
      ['auth/too-many-requests', 'Too many attempts. Please wait a moment.'],
      ['auth/invalid-credential', 'Incorrect email or password.'],
    ])('translates %s', (code, message) => {
      expect(win.friendlyAuthError(code)).toBe(message);
    });

    it('asks the user to report unmapped codes', () => {
      expect(win.friendlyAuthError('auth/unknown')).toBe(
        'Error: auth/unknown — please screenshot this and report it.'
      );
    });
  });

  describe('showTab', () => {
    it('activates the login tab and hides the signup form', () => {
      win.showTab('login');
      expect(doc.getElementById('tabLogin').className).toContain('auth-tab-active');
      expect(doc.getElementById('formLogin').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('formSignup').classList.contains('hidden')).toBe(true);
    });

    it('activates the signup tab and clears stale messages', () => {
      win.showAuthError('boom');
      win.showTab('signup');
      expect(doc.getElementById('tabSignup').className).toContain('auth-tab-active');
      expect(doc.getElementById('formSignup').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('authError').classList.contains('hidden')).toBe(true);
    });
  });

  describe('message banners', () => {
    it('showAuthError displays the error and hides the info banner', () => {
      win.showAuthInfo('info');
      win.showAuthError('nope');
      expect(doc.getElementById('authError').textContent).toBe('nope');
      expect(doc.getElementById('authError').classList.contains('hidden')).toBe(false);
      expect(doc.getElementById('authInfo').classList.contains('hidden')).toBe(true);
    });

    it('showAuthInfo displays the info and hides the error banner', () => {
      win.showAuthError('nope');
      win.showAuthInfo('check your inbox');
      expect(doc.getElementById('authInfo').textContent).toBe('check your inbox');
      expect(doc.getElementById('authError').classList.contains('hidden')).toBe(true);
    });

    it('clearAuthMessages hides both', () => {
      win.showAuthError('nope');
      win.showAuthInfo('info');
      win.clearAuthMessages();
      expect(doc.getElementById('authError').classList.contains('hidden')).toBe(true);
      expect(doc.getElementById('authInfo').classList.contains('hidden')).toBe(true);
    });
  });

  describe('doLogin', () => {
    it('requires both fields', async () => {
      doc.getElementById('loginEmail').value = 'student@example.com';
      doc.getElementById('loginPassword').value = '';
      await win.doLogin();
      expect(doc.getElementById('authError').textContent).toBe('Please fill in both fields.');
      expect(app.auth.calls).toHaveLength(0);
    });

    it('signs in with the trimmed email', async () => {
      doc.getElementById('loginEmail').value = '  student@example.com  ';
      doc.getElementById('loginPassword').value = 'hunter22';
      await win.doLogin();
      expect(app.auth.calls).toEqual([['signIn', 'student@example.com', 'hunter22']]);
      expect(doc.getElementById('authError').classList.contains('hidden')).toBe(true);
    });

    it('surfaces a friendly message when Firebase rejects', async () => {
      app.auth.nextError = { code: 'auth/wrong-password' };
      doc.getElementById('loginEmail').value = 'student@example.com';
      doc.getElementById('loginPassword').value = 'bad';
      await win.doLogin();
      expect(doc.getElementById('authError').textContent).toBe(
        'Incorrect password. Please try again.'
      );
    });

    it('runs on Enter in the password field', async () => {
      doc.getElementById('loginEmail').value = 'student@example.com';
      doc.getElementById('loginPassword').value = 'hunter22';
      doc.getElementById('loginPassword').dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Enter' })
      );
      await Promise.resolve();
      expect(app.auth.calls).toEqual([['signIn', 'student@example.com', 'hunter22']]);
    });
  });

  describe('doSignup', () => {
    const fill = (email, password, confirm) => {
      doc.getElementById('signupEmail').value = email;
      doc.getElementById('signupPassword').value = password;
      doc.getElementById('signupConfirm').value = confirm;
    };

    it('requires all fields', async () => {
      fill('student@example.com', 'hunter22', '');
      await win.doSignup();
      expect(doc.getElementById('authError').textContent).toBe('Please fill in all fields.');
      expect(app.auth.calls).toHaveLength(0);
    });

    it('rejects mismatched passwords', async () => {
      fill('student@example.com', 'hunter22', 'hunter23');
      await win.doSignup();
      expect(doc.getElementById('authError').textContent).toBe('Passwords do not match.');
      expect(app.auth.calls).toHaveLength(0);
    });

    it('rejects passwords shorter than six characters', async () => {
      fill('student@example.com', 'short', 'short');
      await win.doSignup();
      expect(doc.getElementById('authError').textContent).toBe(
        'Password must be at least 6 characters.'
      );
      expect(app.auth.calls).toHaveLength(0);
    });

    it('creates the account when the form is valid', async () => {
      fill(' student@example.com ', 'hunter22', 'hunter22');
      await win.doSignup();
      expect(app.auth.calls).toEqual([['signUp', 'student@example.com', 'hunter22']]);
    });

    it('reports Firebase failures', async () => {
      app.auth.nextError = { code: 'auth/email-already-in-use' };
      fill('student@example.com', 'hunter22', 'hunter22');
      await win.doSignup();
      expect(doc.getElementById('authError').textContent).toBe(
        'An account with this email already exists.'
      );
    });
  });

  describe('doForgotPassword', () => {
    it('requires an email in the login field', async () => {
      doc.getElementById('loginEmail').value = '   ';
      await win.doForgotPassword();
      expect(doc.getElementById('authError').textContent).toBe('Enter your email above first.');
      expect(app.auth.calls).toHaveLength(0);
    });

    it('confirms that the reset mail was sent', async () => {
      doc.getElementById('loginEmail').value = 'student@example.com';
      await win.doForgotPassword();
      expect(app.auth.calls).toEqual([['reset', 'student@example.com']]);
      expect(doc.getElementById('authInfo').textContent).toBe(
        'Reset email sent to student@example.com. Check your inbox.'
      );
    });

    it('reports Firebase failures', async () => {
      app.auth.nextError = { code: 'auth/invalid-email' };
      doc.getElementById('loginEmail').value = 'nope';
      await win.doForgotPassword();
      expect(doc.getElementById('authError').textContent).toBe(
        'Please enter a valid email address.'
      );
    });
  });

  describe('auth state transitions', () => {
    it('swaps to the app screen and enables sync on sign in', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      expect(doc.getElementById('authScreen').style.display).toBe('none');
      expect(doc.getElementById('appScreen').style.display).toBe('block');
      expect(doc.getElementById('userEmailDisplay').textContent).toBe('student@example.com');
      expect(win.app.sync.enabled).toBe(true);
    });

    it('returns to the auth screen and clears subjects on sign out', async () => {
      app.firestore.docs.set('users/user-1/profile/settings', { subjects: ['Biology'] });
      await signIn(app);
      await app.auth.handler(null);
      expect(doc.getElementById('appScreen').style.display).toBe('none');
      expect(doc.getElementById('authScreen').style.display).toBe('flex');
      expect(win.app.SUBJECTS).toEqual([]);
      expect(win.app.sync.enabled).toBe(false);
    });

    it('signs out through Firebase only after confirmation', async () => {
      win.__confirmAnswer = false;
      doc.getElementById('signOutBtn').click();
      await Promise.resolve();
      expect(app.auth.calls).toHaveLength(0);

      win.__confirmAnswer = true;
      doc.getElementById('signOutBtn').click();
      await Promise.resolve();
      expect(app.auth.calls).toEqual([['signOut']]);
    });
  });
});
