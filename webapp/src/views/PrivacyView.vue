<!-- ponytail: текст — черновик по тому, что реально хранит БД (prisma/schema.prisma). Поля в [скобках]
     заполнить и показать юристу; при новых данных в схеме — дописать сюда. -->

<script setup lang="ts">
import { i18next } from '../i18n';

// Юридический текст — целиком на каждом языке, не ключами словаря. Действует русская редакция,
// английская — перевод для удобства (так и написано в ней). Экран пересоздаётся при смене языка.
const en = i18next.language === 'en';
</script>

<template>
  <main v-if="en" class="page" lang="en">
    <h1>Privacy policy</h1>
    <p class="hint">Version of 13.10.2026. This is a translation for convenience; if it differs from the Russian version, the Russian version prevails.</p>

    <section>
      <h2>1. Who processes the data</h2>
      <p>
        The personal data operator is [full name / sole proprietor / company, tax ID] (“we”). Fixum works as a
        Telegram bot and mini app. For questions about your data, contact support: message the bot or use
        “Support” in the app[, or e-mail].
      </p>
    </section>

    <section>
      <h2>2. What data we store</h2>
      <ul>
        <li>
          from Telegram: your ID, username (@username), name and Telegram interface language — Telegram passes them
          when you open the bot or the app;
        </li>
        <li>the app language, if you chose it in your profile;</li>
        <li>orders you post: title, description, budget, video requirements, category, deadline;</li>
        <li>your applications: links to posts, view counts, earnings and statuses;</li>
        <li>withdrawal requests: amount, wallet, status and the reason for rejection, if any;</li>
        <li>your USDT (TRC20) wallet address for payouts, if you added it to your profile;</li>
        <li>advertisers' ratings and reviews of creators, and the advertiser's consent to show a video in the creator's portfolio;</li>
        <li>links to your social media, if you added them to your profile;</li>
        <li>
          if you connected a TikTok, VK or Instagram account in your profile — the account's ID and name on the
          platform and access keys to it (encrypted), as well as views and likes of the videos you submitted for
          orders. We don't request your other videos, messages, friends or followers;
        </li>
        <li>moderators' comments on orders and videos;</li>
        <li>reports you sent: what about, the reason and the comment;</li>
        <li>if your account is blocked — the date and reason;</li>
        <li>the dates these records were created and changed.</li>
      </ul>
      <p>
        We don't store your profile photo: when a profile is viewed we get it from Telegram, and only if your
        Telegram privacy settings allow it.
      </p>
      <p>
        Conversations with support are kept in Telegram, in a private support chat, not in the Fixum database.
        Only you and moderators see your wallet address — it is not shown to advertisers.
      </p>
      <p>We don't receive your phone number, contact list or conversations with other people.</p>
    </section>

    <section>
      <h2>3. Why</h2>
      <ul>
        <li>to show orders and applications and connect advertisers with creators;</li>
        <li>to moderate orders, videos, reviews and reports, and to protect against fraud;</li>
        <li>to pay for accepted videos;</li>
        <li>
          to count video views automatically on connected platforms and make sure a submitted video was posted
          from your account;
        </li>
        <li>to answer support questions and send notifications to the bot chat;</li>
        <li>for anonymised statistics of how the service works: how many orders and videos, how long moderation takes.</li>
      </ul>
      <p>
        The legal basis is performing our agreement with you (Art. 6 Part 1 Clause 5 of Federal Law 152-FZ): the
        service doesn't work without this data. No advertising, profiling or selling of data.
      </p>
    </section>

    <section>
      <h2>4. Who sees the data</h2>
      <ul>
        <li>
          The other party sees only your name and photo from Telegram — not your @username or social media links:
          all communication and payments go through Fixum.
        </li>
        <li>
          A creator's profile — rating, reviews, number of accepted videos and titles of portfolio works — is seen by
          advertisers the creator sent videos to. The review author's name and video links are not shown to them.
        </li>
        <li>Only moderators see who sent a report — the person reported doesn't find out.</li>
        <li>Fixum moderators and managers see orders, applications, profiles and reports in full.</li>
      </ul>
      <p>
        Data is not passed to third parties, except Telegram, through which the service works, and cases required by
        law. Advertisers don't see your connected TikTok, VK or Instagram account; from the platform itself we only
        request statistics of your videos using the key you gave us.
      </p>
    </section>

    <section>
      <h2>5. Where and how long we store it</h2>
      <p>
        Data is stored on a server in [country, city / hosting provider]. We keep it while you use the service; after
        a deletion request we delete it within 30 days.
      </p>
    </section>

    <section>
      <h2>6. Your rights</h2>
      <p>
        You can ask what data about you is stored, correct it or delete it. Contact support — we'll reply within 10
        business days. You can disconnect a connected platform account in your profile at any time — its access keys
        are deleted immediately; you can also revoke access in the platform's own settings. You can also file a
        complaint with Roskomnadzor.
      </p>
    </section>

    <section>
      <h2>7. Changes</h2>
      <p>A new version takes effect once published here; the version date is at the top of the page.</p>
    </section>
  </main>

  <main v-else class="page">
    <h1>Политика конфиденциальности</h1>
    <p class="hint">Редакция от 13.10.2026</p>

    <section>
      <h2>1. Кто обрабатывает данные</h2>
      <p>
        Оператор персональных данных — [ФИО / ИП / ООО, ИНН] (далее — «мы»). Сервис Fixum работает как
        Telegram-бот и мини-приложение. По вопросам о данных напишите в поддержку: сообщением боту или
        через «Поддержка» в приложении[, либо на e-mail].
      </p>
    </section>

    <section>
      <h2>2. Какие данные мы храним</h2>
      <ul>
        <li>
          из Telegram: ваш ID, имя пользователя (@username), имя и язык интерфейса Telegram — их передаёт
          Telegram при открытии бота или приложения;
        </li>
        <li>язык приложения, если вы выбрали его в профиле;</li>
        <li>заказы, которые вы размещаете: название, описание, бюджет, требования к ролику, категорию, срок;</li>
        <li>ваши отклики: ссылки на публикации, число просмотров, начисления и статусы;</li>
        <li>заявки на вывод: сумма, кошелёк, статус и причина отказа, если он был;</li>
        <li>адрес кошелька USDT (TRC20) для выплат, если вы указали его в профиле;</li>
        <li>оценки и отзывы рекламодателей о креаторах, согласие рекламодателя показывать видео в портфолио креатора;</li>
        <li>ссылки на ваши соцсети, если вы добавили их в профиль;</li>
        <li>
          если вы подключили аккаунт TikTok, VK или Instagram в профиле — идентификатор и имя аккаунта на
          площадке и ключи доступа к нему (в зашифрованном виде), а также просмотры и лайки ваших роликов,
          которые вы сдали по заказам. Другие ваши ролики, сообщения, друзей и подписчиков мы не запрашиваем;
        </li>
        <li>комментарии модераторов к заказам и видео;</li>
        <li>жалобы, которые вы отправили: на что, причина и комментарий;</li>
        <li>если аккаунт заблокирован — дату и причину блокировки;</li>
        <li>даты создания и изменения этих записей.</li>
      </ul>
      <p>
        Фото профиля мы не храним: при просмотре профиля получаем его у Telegram, и только если ваши
        настройки приватности в Telegram это разрешают.
      </p>
      <p>
        Переписка с поддержкой хранится в Telegram, в закрытом чате поддержки, а не в базе Fixum.
        Адрес кошелька видите только вы и модераторы — рекламодателям он не показывается.
      </p>
      <p>Мы не получаем ваш номер телефона, список контактов и переписку с другими людьми.</p>
    </section>

    <section>
      <h2>3. Зачем</h2>
      <ul>
        <li>чтобы показывать заказы и отклики, связывать рекламодателей и креаторов;</li>
        <li>для модерации заказов, видео, отзывов и жалоб, для защиты от мошенничества;</li>
        <li>чтобы рассчитаться за принятые видео;</li>
        <li>
          чтобы автоматически считать просмотры роликов на подключённых площадках и убеждаться, что
          сданный ролик опубликован с вашего аккаунта;
        </li>
        <li>чтобы отвечать на вопросы в поддержке и присылать уведомления в чат с ботом;</li>
        <li>для обезличенной статистики работы сервиса: сколько заказов и видео, сколько времени занимает модерация.</li>
      </ul>
      <p>
        Основание — исполнение соглашения с вами (ст. 6 ч. 1 п. 5 152-ФЗ): без этих данных сервис не
        работает. Реклама, профилирование и продажа данных — нет.
      </p>
    </section>

    <section>
      <h2>4. Кто видит данные</h2>
      <ul>
        <li>
          Другая сторона сделки видит только ваше имя и фото из Telegram — не @username и не ссылки на
          соцсети: всё общение и оплата идут через Fixum.
        </li>
        <li>
          Профиль креатора — рейтинг, отзывы, число принятых видео и названия работ в портфолио — видят
          рекламодатели, которым креатор присылал видео. Имя автора отзыва и ссылки на видео им не
          показываются.
        </li>
        <li>Кто отправил жалобу, видят только модераторы — тот, на кого пожаловались, об этом не узнаёт.</li>
        <li>Модераторы и менеджеры Fixum видят заказы, отклики, профили и жалобы целиком.</li>
      </ul>
      <p>
        Третьим лицам данные не передаются, кроме Telegram, через который работает сервис, и случаев,
        предусмотренных законом. Подключённый аккаунт TikTok, VK или Instagram рекламодатель не видит; у самой
        площадки мы только запрашиваем статистику ваших роликов по ключу, который вы нам выдали.
      </p>
    </section>

    <section>
      <h2>5. Где и сколько храним</h2>
      <p>
        Данные хранятся на сервере в [страна, город / хостинг-провайдер]. Храним, пока вы пользуетесь
        сервисом; после запроса на удаление — удаляем в течение 30 дней. [Уточнить с юристом: храним ли
        после удаления сведения о блокировке, чтобы нарушитель не вернулся с новым аккаунтом.]
      </p>
    </section>

    <section>
      <h2>6. Ваши права</h2>
      <p>
        Вы можете запросить, какие данные о вас хранятся, исправить их или удалить. Напишите в
        поддержку — ответим в течение 10 рабочих дней. Подключённый аккаунт площадки можно отключить
        в любой момент в профиле — ключи доступа к нему удаляются сразу; отозвать доступ можно и в
        настройках самой площадки. Жалобу можно также подать в Роскомнадзор.
      </p>
    </section>

    <section>
      <h2>7. Изменения</h2>
      <p>Новая редакция действует с момента публикации здесь; дата редакции — вверху страницы.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
  line-height: 1.45;
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
p,
ul {
  margin: 0 0 6px;
}
ul {
  padding-left: 20px;
}
.hint {
  color: var(--hint);
}
</style>
