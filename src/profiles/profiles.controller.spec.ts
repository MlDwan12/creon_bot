import type { User } from '@prisma/client';
import type { ApiRequest } from '../auth/init-data.guard';
import type { ModeratorGuard } from '../auth/moderator.guard';
import type { TelegramPhotosService } from '../telegram/telegram-photos.service';
import type { NotificationsService } from '../telegram/notifications.service';
import { ProfilesController } from './profiles.controller';
import type { ProfilesService } from './profiles.service';

const WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('PUT /api/profile/wallet', () => {
  const walletChanged = jest.fn();
  const updateWallet = jest.fn();
  const controller = new ProfilesController(
    { updateWallet } as unknown as ProfilesService,
    {} as ModeratorGuard,
    {} as TelegramPhotosService,
    { walletChanged } as unknown as NotificationsService,
  );
  const req = (payoutWallet: string | null) =>
    ({ user: { id: 1, payoutWallet } as User }) as ApiRequest;

  beforeEach(() => {
    walletChanged.mockClear();
    updateWallet.mockClear();
  });

  it('смена и удаление кошелька — уведомление владельцу', async () => {
    await controller.updateWallet({ wallet: WALLET }, req(null));
    await controller.updateWallet({ wallet: '' }, req(WALLET));
    expect(walletChanged.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      WALLET,
      null,
    ]);
    // первый ввод — не смена: модератору у заявки на вывод предупреждение только о смене
    expect(updateWallet.mock.calls).toEqual([
      [1, WALLET, false],
      [1, null, true],
    ]);
  });

  it('тот же адрес — без уведомления', async () => {
    await controller.updateWallet({ wallet: ` ${WALLET} ` }, req(WALLET));
    expect(walletChanged).not.toHaveBeenCalled();
    expect(updateWallet).not.toHaveBeenCalled();
  });
});

describe('PUT /api/profile/cabinet', () => {
  const updateCabinet = jest.fn();
  const controller = new ProfilesController(
    { updateCabinet } as unknown as ProfilesService,
    {} as ModeratorGuard,
    {} as TelegramPhotosService,
    {} as NotificationsService,
  );
  const req = { user: { id: 7 } as User } as ApiRequest;

  it('creator и advertiser — в enum базы', async () => {
    await controller.updateCabinet('creator', req);
    await controller.updateCabinet('advertiser', req);
    expect(updateCabinet.mock.calls).toEqual([
      [7, 'CREATOR'],
      [7, 'ADVERTISER'],
    ]);
  });

  it('другое значение — 400', async () => {
    await expect(controller.updateCabinet('moderator', req)).rejects.toThrow(
      'cabinet — creator или advertiser',
    );
  });
});
