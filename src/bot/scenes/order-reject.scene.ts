import { Injectable } from '@nestjs/common';
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { moderatorMenuKeyboard } from '../keyboards/menu.keyboard';
import { MAX_COMMENT_LENGTH } from '../utils/validation';
import { OrdersService } from '../../orders/orders.service';

export const ORDER_REJECT_SCENE_ID = 'order-reject';

@Injectable()
@Wizard(ORDER_REJECT_SCENE_ID)
export class OrderRejectWizard {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(0)
  async askReason(@Ctx() ctx: BotContext) {
    await ctx.reply(
      'Причина отклонения заказа (текстом, или /cancel для отмены):',
    );
    ctx.wizard.next();
  }

  @WizardStep(1)
  async finish(@Ctx() ctx: BotContext) {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите причину текстом.');
      return;
    }
    const { orderId } = ctx.scene.state as { orderId: number };
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
    const order = await this.ordersService.moderatorReject(
      orderId,
      BigInt(ctx.from!.id),
      comment,
    );
    await ctx.reply(
      'Заказ отклонён, рекламодателю отправлено уведомление.',
      moderatorMenuKeyboard(),
    );
    try {
      await ctx.telegram.sendMessage(
        order.advertiser.telegramId.toString(),
        `❌ Ваш заказ «${order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете разместить заказ заново, учтя замечания.`,
      );
    } catch {
      // рекламодатель мог заблокировать бота
    }
    await ctx.scene.leave();
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    await ctx.reply('Отменено.', moderatorMenuKeyboard());
    await ctx.scene.leave();
  }
}
