import { useTranslation } from 'react-i18next';
import { tList } from '../i18n';
import s from '../ui.module.css';

/** Как устроена реклама в Fixum и частые вопросы — как в мини-аппе (webapp/src/views/HelpView.tsx). */
export function Help() {
  const { t } = useTranslation();
  const faq = t('help.faq', { returnObjects: true }) as unknown as {
    q: string;
    a: string;
  }[];
  return (
    <div className={s.page}>
      <h1>{t('help.title')}</h1>
      <ol className={s.steps}>
        {tList('onboarding.advertiser.steps').map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>{t('help.faqTitle')}</h2>
      {/* <details> — раскрывается сам, без кода и с клавиатуры */}
      {faq.map((f) => (
        <details key={f.q} className={s.card}>
          <summary>{f.q}</summary>
          <p className={s.hint}>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
