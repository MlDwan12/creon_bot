import { Injectable } from '@nestjs/common';
import { Command, Ctx, On, Scene, SceneEnter } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { NotificationsService } from '../notifications.service';
import { errorMessage } from '../utils/error.util';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../utils/validation';
import { deleteIncoming, editForm, sendForm } from '../utils/wizard-form.util';
import { SubmissionsService } from '../../submissions/submissions.service';

export const SUBMIT_VIDEO_SCENE_ID = 'submit-video';

const PROMPT = 'Пришлите ссылку на готовое видео (или /cancel для отмены):';

interface SubmitVideoState {
  submissionId: number;
  formMessageId?: number;
}

@Injectable()
@Scene(SUBMIT_VIDEO_SCENE_ID)
export class SubmitVideoScene {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  @SceneEnter()
  async onEnter(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as SubmitVideoState;
    // Вошли по нажатию кнопки на карточке отклика — продолжаем редактировать то же сообщение.
    const cardMessageId = ctx.callbackQuery?.message?.message_id;
    if (cardMessageId) {
      state.formMessageId = cardMessageId;
      await editForm(ctx, cardMessageId, PROMPT);
    } else {
      state.formMessageId = await sendForm(ctx, PROMPT);
    }
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as SubmitVideoState;
    await deleteIncoming(ctx);
    if (state.formMessageId) {
      try {
        await editForm(ctx, state.formMessageId, '✖️ Отменено.');
      } catch {
        // сообщение формы уже могло исчезнуть
      }
    }
    await ctx.scene.leave();
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as SubmitVideoState;
    if (!ctx.message || !('text' in ctx.message)) return;
    const url = ctx.message.text.trim();
    await deleteIncoming(ctx);

    if (!VIDEO_URL_RE.test(url)) {
      await editForm(
        ctx,
        state.formMessageId!,
        'Похоже, это не ссылка. Пришлите корректный URL (начинается с http:// или https://), или /cancel для отмены:',
      );
      return;
    }
    if (url.length > MAX_URL_LENGTH) {
      await editForm(
        ctx,
        state.formMessageId!,
        `Ссылка слишком длинная (максимум ${MAX_URL_LENGTH} символов). Пришлите более короткую ссылку, или /cancel для отмены:`,
      );
      return;
    }

    let submission: Awaited<
      ReturnType<typeof this.submissionsService.attachVideo>
    >;
    try {
      submission = await this.submissionsService.attachVideo(
        state.submissionId,
        getCurrentUser(ctx).id,
        url,
      );
    } catch (err) {
      await editForm(ctx, state.formMessageId!, `⚠️ ${errorMessage(err)}`);
      await ctx.scene.leave();
      return;
    }
    await editForm(
      ctx,
      state.formMessageId!,
      '✅ Работа отправлена на модерацию.',
    );

    await this.notifications.videoSubmitted(submission);
    await ctx.scene.leave();
  }
}
