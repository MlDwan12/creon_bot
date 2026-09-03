import { Injectable } from '@nestjs/common';
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { errorMessage } from '../utils/error.util';
import { isMeaningfulText, MAX_COMMENT_LENGTH } from '../utils/validation';
import { deleteIncoming, editForm, sendForm } from '../utils/wizard-form.util';
import { OrdersService } from '../../orders/orders.service';

export const ORDER_REJECT_SCENE_ID = 'order-reject';

const PROMPT = 'Причина отклонения заказа (текстом, или /cancel для отмены):';

interface OrderRejectState {
  orderId: number;
  formMessageId?: number;
}

@Injectable()
@Wizard(ORDER_REJECT_SCENE_ID)
export class OrderRejectWizard {
  constructor(private readonly ordersService: OrdersService) {}

  @WizardStep(0)
  async askReason(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as OrderRejectState;
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
    const state = ctx.scene.state as OrderRejectState;
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
    let order: Awaited<ReturnType<typeof this.ordersService.moderatorReject>>;
    try {
      order = await this.ordersService.moderatorReject(
        state.orderId,
        BigInt(ctx.from!.id),
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
      'Заказ отклонён, рекламодателю отправлено уведомление.',
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
    const state = ctx.scene.state as OrderRejectState;
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
