import { useTranslation } from 'react-i18next';
import SupportLink from '../components/SupportLink';
import { tList } from '../i18n';
import s from './HelpView.module.css';

/** Кабинет заказчика: как устроена реклама в Fixum и частые вопросы. Креатору то же — «Обучение». */
export default function HelpView() {
  const { t } = useTranslation();
  const faq = t('help.faq', { returnObjects: true }) as unknown as {
    q: string;
    a: string;
  }[];
  return (
    <main className={s.page}>
      <h1>{t('help.title')}</h1>
      <ol className={s.steps}>
        {tList('onboarding.advertiser.steps').map((step, i) => (
          <li key={step}>
            <span className={s.num} aria-hidden="true">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <h2 className="section-title">{t('help.faqTitle')}</h2>
      {/* <details> — раскрывается сам, без кода и с клавиатуры */}
      {faq.map((f) => (
        <details key={f.q} className={s.faq}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}

      <SupportLink />
    </main>
  );
}
