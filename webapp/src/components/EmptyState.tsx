import type { AriaRole, ReactNode } from 'react';
import s from './EmptyState.module.css';

/**
 * Пустой экран или список: значок, заголовок, пояснение и действие (children) — вместо строки
 * серого текста. Значок — `icon` (inline SVG).
 */
export default function EmptyState(props: {
  title: string;
  text?: string;
  icon?: ReactNode;
  role?: AriaRole;
  children?: ReactNode;
}) {
  return (
    <section className={s.empty} role={props.role}>
      <span className={s.icon} aria-hidden="true">
        {props.icon}
      </span>
      <h2>{props.title}</h2>
      {props.text && <p>{props.text}</p>}
      {props.children}
    </section>
  );
}
