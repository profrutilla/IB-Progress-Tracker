// Loads the single-file app (index.html) into a jsdom window so its inline
// script can be unit tested. External CDN scripts (Tailwind, Lucide, Firebase)
// are replaced with in-memory stubs, and Firestore/Auth are backed by small
// fakes whose behaviour the tests drive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX_HTML = path.join(ROOT, 'index.html');
export const COVERAGE_DIR = path.join(ROOT, '.function-coverage');

/** Names of the top-level functions declared by the app's inline script. */
export function declaredFunctions(html = fs.readFileSync(INDEX_HTML, 'utf8')) {
  return [...html.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
}

// `npm run coverage` re-runs the suite with this flag so every app function
// called through `window` is recorded.
const trackCoverage = process.env.FN_COVERAGE === '1';
const covered = new Set();

// Vitest runs test files in worker threads, so each worker flushes its own
// file as soon as a new function is seen rather than relying on exit hooks.
const coverageFile = path.join(
  COVERAGE_DIR,
  `${process.pid}-${Math.random().toString(36).slice(2)}.json`
);

function record(name) {
  if (covered.has(name)) return;
  covered.add(name);
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  fs.writeFileSync(coverageFile, JSON.stringify([...covered]));
}

function instrument(window, names) {
  for (const name of names) {
    const original = window[name];
    if (typeof original !== 'function') continue;
    window[name] = function tracked(...args) {
      record(name);
      return original.apply(this, args);
    };
  }
}

function createFirestoreFake() {
  const docs = new Map();
  const listeners = new Map();

  const docRef = (docPath) => ({
    path: docPath,
    async get() {
      const data = docs.get(docPath);
      return { exists: data !== undefined, data: () => data };
    },
    async set(value, options = {}) {
      const prev = docs.get(docPath);
      docs.set(docPath, options.merge && prev ? { ...prev, ...value } : value);
    },
    onSnapshot(onNext, onError) {
      const entry = { onNext, onError };
      listeners.set(docPath, entry);
      return () => {
        if (listeners.get(docPath) === entry) listeners.delete(docPath);
      };
    },
    collection: (name) => collectionRef(`${docPath}/${name}`),
  });

  const collectionRef = (collectionPath) => ({
    doc: (id) => docRef(`${collectionPath}/${id}`),
  });

  const db = { collection: (name) => collectionRef(name) };

  return {
    db,
    docs,
    /** Deliver a snapshot to the listener registered for `docPath`. */
    emitSnapshot(docPath, { exists = true, data = undefined, hasPendingWrites = false } = {}) {
      const listener = listeners.get(docPath);
      if (!listener) throw new Error(`no onSnapshot listener for ${docPath}`);
      listener.onNext({ exists, metadata: { hasPendingWrites }, data: () => data });
    },
    emitSnapshotError(docPath, error) {
      const listener = listeners.get(docPath);
      if (!listener) throw new Error(`no onSnapshot listener for ${docPath}`);
      listener.onError(error);
    },
    hasListener: (docPath) => listeners.has(docPath),
  };
}

function createAuthFake() {
  const auth = {
    calls: [],
    handler: null,
    onAuthStateChanged(handler) {
      auth.handler = handler;
      return () => { auth.handler = null; };
    },
    async signInWithEmailAndPassword(email, password) {
      auth.calls.push(['signIn', email, password]);
      if (auth.nextError) throw auth.nextError;
    },
    async createUserWithEmailAndPassword(email, password) {
      auth.calls.push(['signUp', email, password]);
      if (auth.nextError) throw auth.nextError;
    },
    async sendPasswordResetEmail(email) {
      auth.calls.push(['reset', email]);
      if (auth.nextError) throw auth.nextError;
    },
    async signOut() {
      auth.calls.push(['signOut']);
    },
  };
  return auth;
}

/**
 * Boot the app in jsdom.
 * @returns {{window: Window, document: Document, auth: object, firestore: object, dom: JSDOM}}
 */
export function loadApp({ html = fs.readFileSync(INDEX_HTML, 'utf8') } = {}) {
  const auth = createAuthFake();
  const firestore = createFirestoreFake();

  // Drop the CDN <script src> tags — jsdom must not fetch the network.
  const withoutCdn = html.replace(/<script src="https?:[^"]*"><\/script>/g, '');

  // The app's top-level `let`/`const` bindings live in the global lexical
  // environment rather than on `window`, so a trailing script is appended to
  // expose them (scripts share that environment).
  const bridge = `<script>
    window.app = {
      get state() { return state; },
      set state(v) { state = v; },
      get SUBJECTS() { return SUBJECTS; },
      set SUBJECTS(v) { SUBJECTS = v; },
      get currentUser() { return currentUser; },
      get undoStack() { return undoStack; },
      get pickerSelected() { return pickerSelected; },
      sync, els, IB_GROUPS, ALL_SUBJECTS, TYPE_LABELS, demoEntries, STORAGE_KEY,
    };
  </script>`;
  const withBridge = withoutCdn.replace('</body>', `${bridge}</body>`);

  const dom = new JSDOM(withBridge, {
    url: 'https://tracker.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.tailwind = { config: {} };
      window.lucide = { createIcons: () => { window.lucide.createIconsCalls++; } };
      window.lucide.createIconsCalls = 0;
      window.firebase = {
        initializeApp: (config) => ({ config }),
        auth: () => auth,
        firestore: () => firestore.db,
      };
      window.firebase.firestore.FieldValue = {
        serverTimestamp: () => '<<serverTimestamp>>',
      };
      if (!window.crypto) window.crypto = {};
      if (!window.crypto.randomUUID) {
        let n = 0;
        window.crypto.randomUUID = () => `uuid-${++n}`;
      }
      if (!window.structuredClone) {
        window.structuredClone = (value) => JSON.parse(JSON.stringify(value));
      }
      window.alert = (msg) => { window.__alerts.push(msg); };
      window.confirm = () => window.__confirmAnswer;
      window.__alerts = [];
      window.__confirmAnswer = true;
    },
  });

  if (trackCoverage) instrument(dom.window, declaredFunctions(html));

  return { dom, window: dom.window, document: dom.window.document, auth, firestore };
}

let entrySeq = 0;

/** Build an entry with sensible defaults so tests only state what matters. */
export function makeEntry(overrides = {}) {
  entrySeq += 1;
  return {
    id: `e${entrySeq}`,
    type: 'task',
    subject: 'Biology',
    title: `Entry ${entrySeq}`,
    week: 'Week 1',
    duration: '',
    score: '',
    status: 'todo',
    notes: '',
    createdAt: 1000 + entrySeq,
    updatedAt: 1000 + entrySeq,
    ...overrides,
  };
}

/** Sign a user in through the app's own onAuthStateChanged handler. */
export async function signIn(app, { uid = 'user-1', email = 'student@example.com' } = {}) {
  await app.auth.handler({ uid, email });
  return { uid, email };
}
