export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="ui-empty-state">
      {Icon && <span className="ui-empty-icon"><Icon size={22} /></span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
