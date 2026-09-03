import { Injectable } from '@nestjs/common';
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { moderatorMenuKeyboard } from '../keyboards/menu.keyboard';
import { MAX_COMMENT_LENGTH } from '../utils/validation';
import { SubmissionsService } from '../../submissions/submissions.service';

export const MODERATOR_REJECT_SCENE_ID = 'moderator-reject';

@Injectable()
@Wizard(MODERATOR_REJECT_SCENE_ID)
export class ModeratorRejectWizard {
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
    const submission = await this.submissionsService.moderatorReject(
      submissionId,
      BigInt(ctx.from!.id),
      comment,
    );
    await ctx.reply(
      'Отклик отклонён, автору отправлено уведомление.',
      moderatorMenuKeyboard(),
    );
    try {
      await ctx.telegram.sendMessage(
        submission.creator.telegramId.toString(),
        `❌ Ваш отклик на заказ «${submission.order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
      );
    } catch {
      // креатор мог заблокировать бота
    }
    await ctx.scene.leave();
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    await ctx.reply('Отменено.', moderatorMenuKeyboard());
    await ctx.scene.leave();
  }
}
