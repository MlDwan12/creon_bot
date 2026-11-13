import { type Order, type Submission, SubmissionStatus } from '@prisma/client';
import {
  localMoney,
  localNumber,
  titleVisibleToCreators,
} from '../common/format';
import { PLATFORMS, platformOf } from '../common/platforms';
import { HOLD_DAYS } from '../orders/budget';
import {
  BIO_LINK_REMOVED,
  PUBLICATION_DELETED,
} from '../submissions/submissions.service';
import { type Lang, translator } from '../i18n/i18n';

/**
 * Карточка ролика у креатора — виджет Telegram (Bot API 10.4, core.telegram.org/bots/widgets).
 * Код виджета (HTML со строками на языке креатора) отправляется один раз и не меняется; меняется
 * состояние — chat_data, JSON до 1 КБ. Виджет перерисовывается сам по событию chatDataChanged.
 * Пределы Telegram: HTML до 32 КБ и до 4 КБ после zlib, состояние до 1 КБ (проверяет тест).
 */

/** Состояние карточки: от него и вид виджета, и короткий пинг креатору. */
export type CardStatus =
  'review' | 'hold' | 'gone' | 'ready' | 'canceled' | 'rejected';

/** chat_data виджета. Короткие ключи — предел 1 КБ. Всё уже отформатировано на языке креатора. */
export interface CardState {
  s: CardStatus;
  /** Заказ: «Название» или #id, если название не проверено модератором. */
  t: string;
  /** Площадка: название и цвет плашки. */
  p: string;
  c: string;
  /** Просмотры, сумма, дата конца холда «20.11», причина отклонения. */
  v?: string;
  a?: string;
  d?: string;
  r?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_MAX = 60;
const REASON_MAX = 300;

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: '#000',
  YOUTUBE: '#F00',
  VK: '#07F',
  INSTAGRAM: 'linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)',
  X: '#000',
  OTHER: '#5A2DFF',
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function cardStatus(
  sub: Pick<
    Submission,
    'status' | 'finalizedAt' | 'goneAt' | 'moderatorComment'
  >,
): CardStatus {
  if (sub.status === SubmissionStatus.MODERATOR_APPROVED)
    return sub.finalizedAt ? 'ready' : sub.goneAt ? 'gone' : 'hold';
  if (sub.status === SubmissionStatus.MODERATOR_REJECTED)
    return sub.moderatorComment === PUBLICATION_DELETED ||
      sub.moderatorComment === BIO_LINK_REMOVED
      ? 'canceled'
      : 'rejected';
  return 'review';
}

/** Заказ для креатора без HTML: название — только проверенное модератором (как forCreator). */
export function orderForCreator(
  order: Pick<Order, 'id' | 'title' | 'status'>,
  lang: Lang,
) {
  if (!titleVisibleToCreators(order)) return `#${order.id}`;
  const title = clip(order.title, TITLE_MAX);
  return lang === 'en' ? `“${title}”` : `«${title}»`;
}

export function cardState(
  sub: Submission & { order: Pick<Order, 'id' | 'title' | 'status'> },
  lang: Lang,
): CardState {
  const platform = platformOf(sub.videoUrl);
  const s = cardStatus(sub);
  const state: CardState = {
    s,
    t: orderForCreator(sub.order, lang),
    p: platform === 'OTHER' ? '' : PLATFORMS[platform].name,
    c: PLATFORM_COLORS[platform],
  };
  if (sub.views !== null) state.v = localNumber(lang, sub.views);
  // на проверке payoutMinor — резерв за порог, не будущая выплата: не показываем
  if (s === 'hold' || s === 'gone' || s === 'ready')
    state.a = localMoney(lang, sub.payoutMinor);
  if (sub.decidedAt && (s === 'hold' || s === 'gone'))
    state.d = new Date(
      sub.decidedAt.getTime() + HOLD_DAYS * DAY_MS,
    ).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  if (sub.moderatorComment && (s === 'rejected' || s === 'canceled'))
    state.r = clip(sub.moderatorComment, REASON_MAX);
  return state;
}

/** Короткое сообщение-пинг ответом на карточку: правка карточки приходит без звука. */
export function cardPing(state: CardState, lang: Lang): string {
  const t = translator(lang);
  switch (state.s) {
    case 'hold':
      return t('widget.pingApproved', { amount: state.a });
    case 'gone':
      return t('widget.pingGone');
    case 'ready':
      return t('widget.pingReady', { amount: state.a });
    case 'canceled':
      return t('widget.pingCanceled');
    case 'rejected':
      return t('widget.pingRejected');
    default:
      return '';
  }
}

/** Подпись под виджетом — её же видят клиенты без виджетов, она же в списке чатов. */
export function cardCaption(state: CardState, lang: Lang): string {
  return translator(lang)('widget.caption', { order: state.t });
}

const LABEL_KEYS = [
  'review',
  'hold',
  'gone',
  'ready',
  'canceled',
  'rejected',
  'stepSent',
  'stepCheck',
  'stepHold',
  'stepOut',
  'inPlatform',
  'claimed',
  'views',
  'accrued',
  'available',
  'toWithdraw',
  'onDate',
  'reviewHint',
  'holdWarn',
  'goneWarn',
] as const;

const htmlByLang = new Map<Lang, string>();

/** HTML виджета на языке креатора: строки вшиты, данные — из chat_data. */
export function cardHtml(lang: Lang): string {
  const cached = htmlByLang.get(lang);
  if (cached) return cached;
  const t = translator(lang);
  // {{date}} и {{platform}} подставляет сам виджет из состояния
  const labels = Object.fromEntries(
    LABEL_KEYS.map((k) => [
      k,
      t(`widget.${k}`, {
        date: '{{date}}',
        platform: '{{platform}}',
      }),
    ]),
  );
  // < в JSON внутри <script> — чтобы строка перевода не закрыла тег
  const json = JSON.stringify(labels).replace(/</g, '\\u003c');
  const html = CARD_TEMPLATE.replace('__L__', () => json);
  htmlByLang.set(lang, html);
  return html;
}

/**
 * Палитра Fixum: фиолетовый — прогресс, лайм — деньги, оранжевый — ждёт. Фон и текст — из темы чата
 * (--tg-theme-*), пары «фон плашки + текст» — свои, контраст внутри плашки.
 */
const CARD_TEMPLATE = `<style>
body{margin:0;padding:12px 12px 6px}
.h{display:flex;gap:10px;align-items:center}
.i{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none}
.h div{min-width:0}
.t{font-weight:700;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s,.l{color:var(--tg-theme-hint-color);font-size:12px;margin:0}
.c{display:inline-block;margin-top:12px;font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:99px}
.st{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-top:12px}
.b{height:4px;border-radius:2px;background:var(--tg-theme-secondary-bg-color)}
.on .b{background:light-dark(#5A2DFF,#8B6BFF)}
.l{font-size:11px;margin-top:4px}
.cur .l{color:var(--tg-theme-text-color);font-weight:700}
.a{display:flex;justify-content:space-between;align-items:center;background:#D6F44C;color:#17141F;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:12.5px;font-weight:600}
.a b{font-size:22px}
.k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}
.k div{background:var(--tg-theme-secondary-bg-color);border-radius:10px;padding:8px 10px;font-weight:700}
.k small{display:block;color:var(--tg-theme-hint-color);font-size:11.5px;font-weight:400}
.n{font-size:13px;margin:10px 0 0}
.w{font-size:12.5px;margin:10px 0 0;padding:8px 10px;border-radius:10px;background:light-dark(#FFE7D6,#4A2A14);color:light-dark(#7A3300,#FFD2B0)}
</style>
<div class="h"><div class="i" id="i"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" fill="#fff"/></svg></div><div><p class="t" id="t"></p><p class="s" id="p"></p></div></div>
<div id="m"></div>
<script>
const L=__L__,W=window.TelegramWidget;
const C={review:'#FFE7D6;color:#8A3A00',gone:'#FFE7D6;color:#8A3A00',hold:'#E6DEFF;color:#3A16C4',ready:'#D6F44C;color:#17141F',canceled:'#FFDCDC;color:#8E1B1B',rejected:'#FFDCDC;color:#8E1B1B'};
const S={review:1,rejected:1,hold:2,gone:2,canceled:2,ready:3};
const e=x=>String(x??'').replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';');
const f=(x,d)=>x.replace('{{date}}',d??'').replace('{{platform}}',d??'');
const kv=(a,b,c,d)=>'<div class="k"><div><small>'+e(a)+'</small>'+e(b)+'</div>'+(c?'<div><small>'+e(c)+'</small>'+e(d)+'</div>':'')+'</div>';
function r(){
let d={};try{d=JSON.parse(W.chatData)||{}}catch(x){}
const s=d.s||'review',n=S[s];
document.getElementById('i').style.background=d.c||'#5A2DFF';
document.getElementById('t').textContent=d.t||'';
document.getElementById('p').textContent=d.p?f(L.inPlatform,d.p):'';
let h='<span class="c" style="background:'+C[s]+'">'+e(f(L[s],d.d))+'</span><div class="st">';
[L.stepSent,L.stepCheck,L.stepHold,L.stepOut].forEach((x,i)=>{h+='<div class="'+(i<=n?'on':'')+(i==n?' cur':'')+'"><div class="b"></div><p class="l">'+e(x)+'</p></div>'});
h+='</div>';
if(s=='review')h+=kv(L.claimed,d.v)+'<p class="n">'+e(L.reviewHint)+'</p>';
if(s=='hold'||s=='gone'||s=='ready')h+='<div class="a"><b>'+e(d.a)+'</b>'+e(s=='ready'?L.available:L.accrued)+'</div>'+kv(L.views,d.v,s=='hold'?L.toWithdraw:'',f(L.onDate,d.d));
if(s=='hold')h+='<p class="w">'+e(f(L.holdWarn,d.d))+'</p>';
if(s=='gone')h+='<p class="w">'+e(L.goneWarn)+'</p>';
if(d.r)h+='<p class="n">'+e(d.r)+'</p>';
document.getElementById('m').innerHTML=h;
}
if(W){r();W.onEvent('chatDataChanged',r);W.ready()}
</script>`;
