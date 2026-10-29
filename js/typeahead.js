// ============================================
// Type-ahead search input, shared by the admin panel (js/admin.js) and the
// delivery portal (js/delivery.js). Styled by .typeahead* in css/admin.css.
// ============================================

// A search input with a suggestion list under it. From 2 characters on,
// suggest(query) returns the items to list ({ id, label, meta? }); every
// keystroke calls onType(query) and picking an item (click, or Enter for the
// first) puts its label in the input and calls onPick(item).
export function createTypeahead({ input, list, suggest, emptyText, onType, onPick }) {
  let picked = false;
  const query = () => input.value.trim().toLowerCase();

  function hide() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function pick(item) {
    input.value = item.label;
    picked = true;
    hide();
    onPick(item);
  }

  function show() {
    list.innerHTML = '';
    if (query().length < 2 || picked) return hide();
    const items = suggest(query());
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'typeahead-empty';
      empty.textContent = emptyText;
      list.appendChild(empty);
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = item.label;
      if (item.meta) {
        const meta = document.createElement('small');
        meta.textContent = item.meta;
        li.appendChild(meta);
      }
      // mousedown fires before the input's blur hides the list.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(item);
      });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('input', () => {
    picked = false;
    show();
    onType(query());
  });
  input.addEventListener('focus', show);
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    if (e.key === 'Enter' && !picked && query().length >= 2) {
      const [first] = suggest(query());
      if (first) {
        e.preventDefault();
        pick(first);
      }
    }
  });

  return {
    reset() {
      input.value = '';
      picked = false;
      hide();
    },
  };
}
