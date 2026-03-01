export function PersonaChecklistPanel({ items, checkedState, onToggleItem }) {
  return (
    <aside className="census-panel persona-checklist-panel" aria-live="polite">
      <header className="census-panel__header">
        <h2 className="census-panel__location">Key Points</h2>
        <div className="census-panel__divider" />
      </header>

      <ul className="persona-checklist" aria-label="POI checklist">
        {items.map((item) => {
          const isChecked = Boolean(checkedState?.[item.id]);
          return (
            <li
              key={item.id}
              className={`persona-checklist__item${isChecked ? " is-checked" : ""}`}
            >
              <label className="persona-checklist__label">
                <input
                  className="persona-checklist__checkbox"
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleItem(item.id)}
                />
                <span className="persona-checklist__text">{item.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
