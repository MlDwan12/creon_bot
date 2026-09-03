import { Injectable } from '@nestjs/common';
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { userMenuKeyboard } from '../keyboards/menu.keyboard';
import { MAX_COMMENT_LENGTH } from '../utils/validation';
import { SubmissionsService } from '../../submissions/submissions.service';

export const ADVERTISER_REJECT_SCENE_ID = 'advertiser-reject';

@Injectable()
@Wizard(ADVERTISER_REJECT_SCENE_ID)
export class AdvertiserRejectWizard {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @WizardStep(0)
  async askReason(@Ctx() ctx: BotContext) {
    await ctx.reply('Причина отклонения (текстом, или /cancel для отмены):');
    ctx.wizard.next();
  }

  @WizardStep(1)
  async finish(@Ctx() ctx: BotContext) {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите причину текстом.');
      return;
    }
    const { submissionId } = ctx.scene.state as { submissionId: number };
    const comment = ctx.message.text.trim();
    if (!comment) {
      await ctx.reply('Причина не может быть пустой. Введите текст:');
      return;
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      await ctx.reply(
        `Слишком длинный текст (максимум ${MAX_COMMENT_LENGTH} символов). Сократите и отправьте ещё раз:`,
      );
      return;
    }
    const submission = await this.submissionsService.advertiserReject(
      submissionId,
      getCurrentUser(ctx).id,
      comment,
    );
    await ctx.reply(
      'Отклик отклонён, автору отправлено уведомление.',
      userMenuKeyboard(),
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
    await ctx.reply('Отменено.', userMenuKeyboard());
    await ctx.scene.leave();
  }
}
