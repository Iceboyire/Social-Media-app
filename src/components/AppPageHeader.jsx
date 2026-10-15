export function AppPageHeader({ eyebrow, title, description, action }) {
  return (
    <header className="app-page-header">
      <div>
        {eyebrow && <span className="app-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
