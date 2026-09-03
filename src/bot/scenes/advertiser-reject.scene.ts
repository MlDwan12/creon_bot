import { Injectable } from '@nestjs/common';
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { errorMessage } from '../utils/error.util';
import { isMeaningfulText, MAX_COMMENT_LENGTH } from '../utils/validation';
import { deleteIncoming, editForm, sendForm } from '../utils/wizard-form.util';
import { SubmissionsService } from '../../submissions/submissions.service';

export const ADVERTISER_REJECT_SCENE_ID = 'advertiser-reject';

const PROMPT = 'Причина отклонения (текстом, или /cancel для отмены):';

interface AdvertiserRejectState {
  submissionId: number;
  formMessageId?: number;
}

@Injectable()
@Wizard(ADVERTISER_REJECT_SCENE_ID)
export class AdvertiserRejectWizard {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @WizardStep(0)
  async askReason(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as AdvertiserRejectState;
    const cardMessageId = ctx.callbackQuery?.message?.message_id;
    if (cardMessageId) {
      state.formMessageId = cardMessageId;
      await editForm(ctx, cardMessageId, PROMPT);
    } else {
      state.formMessageId = await sendForm(ctx, PROMPT);
    }
    ctx.wizard.next();
  }

  @WizardStep(1)
  async finish(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as AdvertiserRejectState;
    await deleteIncoming(ctx);
    if (!ctx.message || !('text' in ctx.message)) {
      await editForm(ctx, state.formMessageId!, 'Введите причину текстом.');
      return;
    }
    const comment = ctx.message.text.trim();
    if (!comment || !isMeaningfulText(comment)) {
      await editForm(
        ctx,
        state.formMessageId!,
        'Причина не может быть пустой. Введите текст:',
      );
      return;
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      await editForm(
        ctx,
        state.formMessageId!,
        `Слишком длинный текст (максимум ${MAX_COMMENT_LENGTH} символов). Сократите и отправьте ещё раз:`,
      );
      return;
    }
    let submission: Awaited<
      ReturnType<typeof this.submissionsService.advertiserReject>
    >;
    try {
      submission = await this.submissionsService.advertiserReject(
        state.submissionId,
        getCurrentUser(ctx).id,
        comment,
      );
    } catch (err) {
      await editForm(ctx, state.formMessageId!, `⚠️ ${errorMessage(err)}`);
      await ctx.scene.leave();
      return;
    }
    await editForm(
      ctx,
      state.formMessageId!,
      'Отклик отклонён, автору отправлено уведомление.',
    );
    try {
      await ctx.telegram.sendMessage(
        submission.creator.telegramId.toString(),
        `❌ Рекламодатель отклонил ваше видео по заказу «${submission.order.title}».\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
      );
    } catch {
      // креатор мог заблокировать бота
    }
    await ctx.scene.leave();
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as AdvertiserRejectState;
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
}
