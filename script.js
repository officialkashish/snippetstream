/**
 * SnippetStream Lite — script.js
 * ─────────────────────────────────────────────────────────────
 * A fully client-side code-sharing app.
 *
 * HOW IT WORKS (overview):
 *
 * 1. DATA MODEL (LocalStorage)
 *    All snippets live in localStorage under the key "ss_snippets".
 *    Each snippet is a plain object:
 *    {
 *      id:        string  — unique ID (timestamp-based)
 *      title:     string
 *      language:  string
 *      tags:      string[]
 *      code:      string
 *      votes:     number
 *      createdAt: number  — Date.now()
 *    }
 *    Upvote history lives under "ss_votes" — an array of snippet IDs
 *    the user has already voted on. This prevents duplicate votes.
 *
 * 2. SEARCH & FILTER
 *    On every keystroke we filter the in-memory `snippets` array
 *    by checking if title, language, or any tag includes the query.
 *    No server round-trip needed — it's instant.
 *
 * 3. UPVOTES
 *    When the user clicks ▲, we check `votedIds`. If the snippet ID
 *    is already there, we ignore the click. Otherwise we:
 *    a) increment snippet.votes
 *    b) persist to localStorage
 *    c) add ID to votedIds and persist that too
 *    d) re-render only that card's upvote button (no full re-render)
 *
 * 4. RENDERING
 *    renderFeed() reads from `snippets`, applies the current search
 *    query and language filter, sorts by the active tab, and builds
 *    card HTML via a template string.
 */

const STORAGE_KEY       = 'ss_snippets';   // key for snippets array
const VOTES_KEY         = 'ss_votes';      // key for voted IDs array

// In-memory state — always synced to localStorage
let snippets  = [];    // array of snippet objects
let votedIds  = [];    // IDs the user has already upvoted

// UI state
let searchQuery   = '';    // current search string
let activeLang    = '';    // currently selected language filter pill
let sortMode      = 'newest'; // 'newest' | 'top'
let editingId     = null;  // ID of snippet being edited (null if not editing)

/* ═══════════════════════════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════════════════════════ */

const feedEl        = document.getElementById('feed');
const emptyState    = document.getElementById('empty-state');
const noResults     = document.getElementById('no-results');
const searchInput   = document.getElementById('search-input');
const searchHint    = document.getElementById('search-hint');
const langPillsCont = document.getElementById('lang-pills');
const countBadge    = document.getElementById('snippet-count-badge');
const toastEl       = document.getElementById('toast');

// Form elements
const inputTitle    = document.getElementById('input-title');
const inputLang     = document.getElementById('input-language');
const inputTags     = document.getElementById('input-tags');
const inputCode     = document.getElementById('input-code');
const btnSubmit     = document.getElementById('btn-submit');
const editActions   = document.getElementById('edit-actions');
const btnSaveEdit   = document.getElementById('btn-save-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const formError     = document.getElementById('form-error');

/* ═══════════════════════════════════════════════════════════════
   LOCALSTORAGE HELPERS
   ═══════════════════════════════════════════════════════════════
   These two functions are the only place we read/write localStorage.
   Keeping I/O in one place makes the rest of the code easier to
   reason about and easier to swap for a real API later.
   ═══════════════════════════════════════════════════════════════ */

/** Load all snippets from localStorage into memory. */
function loadFromStorage() {
  try {
    snippets = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    votedIds = JSON.parse(localStorage.getItem(VOTES_KEY))   || [];
  } catch {
    snippets = [];
    votedIds = [];
  }
}

/** Persist current in-memory state to localStorage. */
function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  localStorage.setItem(VOTES_KEY,   JSON.stringify(votedIds));
}

/* ═══════════════════════════════════════════════════════════════
   ID GENERATION
   ═══════════════════════════════════════════════════════════════ */

/** Generate a unique ID using timestamp + random suffix. */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ═══════════════════════════════════════════════════════════════
   DATE FORMATTING
   ═══════════════════════════════════════════════════════════════ */

/** Return a human-readable relative time string, e.g. "3 min ago". */
function timeAgo(timestamp) {
  const diff = (Date.now() - timestamp) / 1000; // seconds
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

/* ═══════════════════════════════════════════════════════════════
   LANGUAGE → CSS CLASS
   ═══════════════════════════════════════════════════════════════ */

/** Convert a language name to a safe CSS class name. */
function langClass(lang) {
  return 'lang-' + (lang || 'other').toLowerCase().replace(/[^a-z0-9+]/g, '-');
}

/* ═══════════════════════════════════════════════════════════════
   SEARCH & FILTER
   ═══════════════════════════════════════════════════════════════
   We filter the full `snippets` array each time — no server needed.
   The query is matched against title, language name, and every tag.
   ═══════════════════════════════════════════════════════════════ */

/** Return snippets that match the current searchQuery and activeLang. */
function getFilteredSnippets() {
  const q = searchQuery.toLowerCase().trim();

  return snippets.filter(s => {
    // Language pill filter
    if (activeLang && s.language !== activeLang) return false;

    // Text search: title, language, or tags
    if (!q) return true;
    const inTitle = s.title.toLowerCase().includes(q);
    const inLang  = s.language.toLowerCase().includes(q);
    const inTags  = s.tags.some(t => t.toLowerCase().includes(q));
    return inTitle || inLang || inTags;
  });
}

/* ═══════════════════════════════════════════════════════════════
   LANGUAGE PILLS (sidebar filter)
   ═══════════════════════════════════════════════════════════════ */

/** Rebuild the language filter pills from current snippets. */
function renderLangPills() {
  // Collect unique languages that exist in snippets
  const langs = [...new Set(snippets.map(s => s.language))].sort();

  langPillsCont.innerHTML = '';

  // "All" pill
  const allPill = document.createElement('span');
  allPill.className = `pill${activeLang === '' ? ' active' : ''}`;
  allPill.textContent = 'All';
  allPill.addEventListener('click', () => setLangFilter(''));
  langPillsCont.appendChild(allPill);

  // One pill per language
  langs.forEach(lang => {
    const pill = document.createElement('span');
    pill.className = `pill${activeLang === lang ? ' active' : ''}`;
    pill.textContent = lang;
    pill.addEventListener('click', () => setLangFilter(lang));
    langPillsCont.appendChild(pill);
  });
}

/** Set the active language filter and re-render. */
function setLangFilter(lang) {
  activeLang = lang;
  renderLangPills();
  renderFeed();
}

/* ═══════════════════════════════════════════════════════════════
   FEED RENDERING
   ═══════════════════════════════════════════════════════════════ */

/** Main render function — called after any state change. */
function renderFeed() {
  let filtered = getFilteredSnippets();

  // Sort
  if (sortMode === 'top') {
    filtered = [...filtered].sort((a, b) => b.votes - a.votes);
  } else {
    filtered = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }

  // Update count badge
  const total = snippets.length;
  countBadge.textContent = `${total} snippet${total !== 1 ? 's' : ''}`;

  // Update search hint
  if (searchQuery) {
    searchHint.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''} found`;
  } else {
    searchHint.textContent = '';
  }

  // Show/hide empty states
  const isEmpty = snippets.length === 0;
  const noMatch = !isEmpty && filtered.length === 0;

  emptyState.classList.toggle('hidden', !isEmpty);
  noResults.classList.toggle('hidden', !noMatch);
  feedEl.classList.toggle('hidden', isEmpty || noMatch);

  if (isEmpty || noMatch) {
    feedEl.innerHTML = '';
    return;
  }

  // Build cards
  feedEl.innerHTML = filtered.map(s => buildCard(s)).join('');

  // Attach event listeners to each card's interactive elements
  filtered.forEach(s => {
    // Upvote
    const btn = document.getElementById(`upvote-${s.id}`);
    if (btn) btn.addEventListener('click', () => handleUpvote(s.id));

    // Copy code
    const copyBtn = document.getElementById(`copy-${s.id}`);
    if (copyBtn) copyBtn.addEventListener('click', () => handleCopy(s.id));

    // Edit
    const editBtn = document.getElementById(`edit-${s.id}`);
    if (editBtn) editBtn.addEventListener('click', () => handleEdit(s.id));

    // Delete
    const delBtn = document.getElementById(`delete-${s.id}`);
    if (delBtn) delBtn.addEventListener('click', () => handleDelete(s.id));

    // Clicking a tag sets it as search query
    document.querySelectorAll(`[data-tag-card="${s.id}"]`).forEach(tagEl => {
      tagEl.addEventListener('click', () => {
        searchInput.value = tagEl.textContent;
        searchQuery = tagEl.textContent;
        renderFeed();
      });
    });
  });
}

/**
 * Build HTML string for a single snippet card.
 * We escape the code to prevent XSS when injecting into innerHTML.
 */
function buildCard(s) {
  const voted = votedIds.includes(s.id);
  const tagsHtml = s.tags.length
    ? s.tags.map(t => `<span class="tag" data-tag-card="${s.id}">${escapeHtml(t)}</span>`).join('')
    : '';

  return `
    <article class="card" id="card-${s.id}">
      <div class="card-header">
        <div class="card-meta">
          <div class="card-title">${escapeHtml(s.title)}</div>
          ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
        </div>
        <span class="lang-badge ${langClass(s.language)}">${escapeHtml(s.language)}</span>
      </div>

      <div class="card-code-wrap">
        <pre><code>${escapeHtml(s.code)}</code></pre>
        <button class="btn-copy" id="copy-${s.id}">copy</button>
      </div>

      <div class="card-footer">
        <div class="card-actions">
          <!-- Upvote: voted class disables further clicks via CSS cursor:default -->
          <button
            class="btn-upvote${voted ? ' voted' : ''}"
            id="upvote-${s.id}"
            title="${voted ? 'Already voted' : 'Upvote this snippet'}"
          >
            <span class="upvote-arrow">▲</span>
            <span id="vote-count-${s.id}">${s.votes}</span>
          </button>
          <button class="btn-icon" id="edit-${s.id}" title="Edit snippet">✏️</button>
          <button class="btn-icon danger" id="delete-${s.id}" title="Delete snippet">🗑️</button>
        </div>
        <span class="card-timestamp">${timeAgo(s.createdAt)}</span>
      </div>
    </article>
  `;
}

/** Escape HTML special chars to prevent XSS from user-submitted code. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════════════════════════
   UPVOTE LOGIC
   ═══════════════════════════════════════════════════════════════
   How it works:
   1. Check if the snippet ID is already in `votedIds`.
   2. If so, bail out — no double voting.
   3. Otherwise, increment votes on the snippet object in memory.
   4. Push the ID into votedIds.
   5. Save both arrays to localStorage (one write each).
   6. Update the vote count & button UI without a full re-render —
      this feels snappier and avoids losing scroll position.
   ═══════════════════════════════════════════════════════════════ */

function handleUpvote(id) {
  // Guard: already voted?
  if (votedIds.includes(id)) return;

  // Find the snippet
  const snippet = snippets.find(s => s.id === id);
  if (!snippet) return;

  // Increment vote
  snippet.votes += 1;

  // Record that this user voted
  votedIds.push(id);

  // Persist changes
  saveToStorage();

  // Update the DOM without full re-render
  const countEl = document.getElementById(`vote-count-${id}`);
  const btnEl   = document.getElementById(`upvote-${id}`);
  if (countEl) countEl.textContent = snippet.votes;
  if (btnEl) {
    btnEl.classList.add('voted');
    btnEl.title = 'Already voted';
  }

  showToast('▲ Upvoted!');
}

/* ═══════════════════════════════════════════════════════════════
   COPY TO CLIPBOARD
   ═══════════════════════════════════════════════════════════════ */

function handleCopy(id) {
  const snippet = snippets.find(s => s.id === id);
  if (!snippet) return;

  navigator.clipboard.writeText(snippet.code).then(() => {
    const btn = document.getElementById(`copy-${id}`);
    if (btn) {
      btn.textContent = '✓ copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'copy';
        btn.classList.remove('copied');
      }, 2000);
    }
    showToast('Code copied to clipboard!');
  }).catch(() => {
    showToast('Copy failed — try selecting manually.');
  });
}

/* ═══════════════════════════════════════════════════════════════
   EDIT SNIPPET
   ═══════════════════════════════════════════════════════════════
   We populate the form with the snippet's data, switch the form
   into "edit mode" (shows Save + Cancel instead of Publish), and
   set editingId so we know which snippet to update on save.
   ═══════════════════════════════════════════════════════════════ */

function handleEdit(id) {
  const snippet = snippets.find(s => s.id === id);
  if (!snippet) return;

  // Populate form
  inputTitle.value = snippet.title;
  inputLang.value  = snippet.language;
  inputTags.value  = snippet.tags.join(', ');
  inputCode.value  = snippet.code;

  // Switch form to edit mode
  editingId = id;
  btnSubmit.classList.add('hidden');
  editActions.classList.remove('hidden');

  // Smooth scroll to form on mobile
  inputTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inputTitle.focus();
}

function handleSaveEdit() {
  if (!validateForm()) return;

  const idx = snippets.findIndex(s => s.id === editingId);
  if (idx === -1) return;

  // Apply changes
  snippets[idx].title    = inputTitle.value.trim();
  snippets[idx].language = inputLang.value;
  snippets[idx].tags     = parseTags(inputTags.value);
  snippets[idx].code     = inputCode.value.trim();

  saveToStorage();
  clearForm();
  renderLangPills();
  renderFeed();
  showToast('Snippet updated ✓');
}

function handleCancelEdit() {
  clearForm();
}

/* ═══════════════════════════════════════════════════════════════
   DELETE SNIPPET
   ═══════════════════════════════════════════════════════════════ */

function handleDelete(id) {
  if (!confirm('Delete this snippet? This cannot be undone.')) return;

  snippets = snippets.filter(s => s.id !== id);
  // Also remove from votedIds to keep storage clean
  votedIds = votedIds.filter(v => v !== id);

  saveToStorage();
  renderLangPills();
  renderFeed();
  showToast('Snippet deleted.');
}

/* ═══════════════════════════════════════════════════════════════
   CREATE SNIPPET
   ═══════════════════════════════════════════════════════════════ */

function handleSubmit() {
  if (!validateForm()) return;

  const newSnippet = {
    id:        generateId(),
    title:     inputTitle.value.trim(),
    language:  inputLang.value,
    tags:      parseTags(inputTags.value),
    code:      inputCode.value.trim(),
    votes:     0,
    createdAt: Date.now()
  };

  // Prepend so newest appears first
  snippets.unshift(newSnippet);
  saveToStorage();
  clearForm();
  renderLangPills();
  renderFeed();
  showToast('Snippet published! 🎉');
}

/* ═══════════════════════════════════════════════════════════════
   FORM HELPERS
   ═══════════════════════════════════════════════════════════════ */

/** Return true if form is valid; show error message otherwise. */
function validateForm() {
  const ok = inputTitle.value.trim() &&
             inputLang.value &&
             inputCode.value.trim();
  formError.classList.toggle('hidden', !!ok);
  return !!ok;
}

/** Parse a comma-separated tag string into a clean array. */
function parseTags(raw) {
  return raw
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && t.length <= 24);
}

/** Reset form fields and exit edit mode. */
function clearForm() {
  inputTitle.value = '';
  inputLang.value  = '';
  inputTags.value  = '';
  inputCode.value  = '';
  formError.classList.add('hidden');
  editingId = null;
  btnSubmit.classList.remove('hidden');
  editActions.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
   ═══════════════════════════════════════════════════════════════ */

let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ═══════════════════════════════════════════════════════════════
   SEED DATA
   ═══════════════════════════════════════════════════════════════
   If localStorage is empty (fresh install), load a few example
   snippets so the feed isn't blank on first open.
   ═══════════════════════════════════════════════════════════════ */

function seedExamples() {
  if (snippets.length > 0) return; // don't overwrite existing data

  const examples = [
    {
      title: 'Debounce Function',
      language: 'JavaScript',
      tags: ['utils', 'performance', 'events'],
      code: `/**
 * Debounce: delays invoking fn until after 'wait' ms
 * have elapsed since the last call.
 */
function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// Usage
const onResize = debounce(() => {
  console.log('Window resized!');
}, 200);

window.addEventListener('resize', onResize);`,
      votes: 12,
      createdAt: Date.now() - 3600 * 1000 * 5
    },
    {
      title: 'Python List Comprehension Cheatsheet',
      language: 'Python',
      tags: ['python', 'lists', 'beginner'],
      code: `# Basic
squares = [x**2 for x in range(10)]

# With condition (filter)
evens = [x for x in range(20) if x % 2 == 0]

# Nested (flatten a 2D list)
matrix = [[1,2],[3,4],[5,6]]
flat = [n for row in matrix for n in row]

# Dict comprehension
word_lengths = {w: len(w) for w in ["hello", "world"]}`,
      votes: 8,
      createdAt: Date.now() - 3600 * 1000 * 2
    },
    {
      title: 'CSS Grid — Two Column Layout',
      language: 'CSS',
      tags: ['layout', 'grid', 'responsive'],
      code: `.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 20px;
}

/* Stack on mobile */
@media (max-width: 768px) {
  .layout {
    grid-template-columns: 1fr;
  }
}`,
      votes: 5,
      createdAt: Date.now() - 3600 * 1000 * 1
    },
    {
      title: 'SQL: Window Function — Running Total',
      language: 'SQL',
      tags: ['sql', 'analytics', 'window-functions'],
      code: `SELECT
  order_date,
  amount,
  SUM(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM orders
ORDER BY order_date;`,
      votes: 3,
      createdAt: Date.now() - 60 * 1000 * 30
    }
  ];

  // Assign IDs
  examples.forEach(ex => {
    snippets.push({ id: generateId(), ...ex });
  });

  saveToStorage();
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING
   ═══════════════════════════════════════════════════════════════ */

// Form submit
btnSubmit.addEventListener('click', handleSubmit);

// Edit mode save / cancel
btnSaveEdit.addEventListener('click', handleSaveEdit);
btnCancelEdit.addEventListener('click', handleCancelEdit);

// Submit on Ctrl+Enter inside code textarea
inputCode.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    editingId ? handleSaveEdit() : handleSubmit();
  }
});

// Search — re-render on every keystroke
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  activeLang  = '';          // clear language filter on search
  renderLangPills();
  renderFeed();
});

// Sort tabs
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sortMode = btn.dataset.sort;
    renderFeed();
  });
});

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */

function init() {
  loadFromStorage();  // pull data from localStorage
  seedExamples();     // add demo snippets if empty
  renderLangPills();  // build sidebar language filters
  renderFeed();       // draw the snippet cards
}

init();
