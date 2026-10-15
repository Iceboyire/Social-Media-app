export function Card({ children, className = '', as: Element = 'section', ...props }) {
  return <Element className={`ui-card ${className}`.trim()} {...props}>{children}</Element>;
}
