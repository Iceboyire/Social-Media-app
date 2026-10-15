export function Tabs({ items, value, onChange, label, className = '' }) {
  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {items.map(({ value: itemValue, label: itemLabel, icon: Icon, badge }) => (
        <button
          key={itemValue}
          type="button"
          role="tab"
          aria-selected={value === itemValue}
          className={`ui-tab${value === itemValue ? ' ui-tab-active' : ''}`}
          onClick={() => onChange(itemValue)}
        >
          {Icon && <Icon size={18} strokeWidth={1.8} />}
          <span>{itemLabel}</span>
          {badge}
        </button>
      ))}
    </div>
  );
}
