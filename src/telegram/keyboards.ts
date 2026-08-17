import type { InlineKeyboardButton, InlineKeyboardMarkup } from './types';

/** Main menu shown on /start (buttons vary for admins). */
export function startMenuKeyboard(admin: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '🎉 Giveaway Aktif', callback_data: 'menu:active' }],
    [
      { text: '🎟 Entry Saya', callback_data: 'menu:entries' },
      { text: '❓ Cara Ikut', callback_data: 'menu:howto' },
    ],
  ];
  if (admin) {
    rows.push([
      { text: '➕ Buat Giveaway', callback_data: 'menu:new' },
      { text: '📊 Statistik', callback_data: 'menu:stats' },
    ]);
  }
  return { inline_keyboard: rows };
}

/** Single "back to main menu" button. */
export function backKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu:home' }]] };
}

/** In-menu giveaway view: JOIN + back. */
export function activeMenuKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🎉 JOIN GIVEAWAY', callback_data: `join:${giveawayId}` }],
      [{ text: '⬅️ Kembali', callback_data: 'menu:home' }],
    ],
  };
}

/** In-menu entries view: invite friends + back. */
export function entriesMenuKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '👥 INVITE FRIENDS', callback_data: `invite:${giveawayId}` }],
      [{ text: '⬅️ Kembali', callback_data: 'menu:home' }],
    ],
  };
}

/** JOIN button shown on the published giveaway post. */
export function joinKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '🎉 JOIN GIVEAWAY', callback_data: `join:${giveawayId}` }]] };
}

/** Shown when the user has not met the channel-join requirement. */
export function notEligibleKeyboard(giveawayId: number, channelUrl: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📢 JOIN CHANNEL', url: channelUrl }],
      [{ text: '✅ CHECK AGAIN', callback_data: `check:${giveawayId}` }],
    ],
  };
}

/** Shown after the user successfully joins. */
export function participatingKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '👥 INVITE FRIENDS', callback_data: `invite:${giveawayId}` }],
      [{ text: '🎟 MY ENTRIES', callback_data: `entries:${giveawayId}` }],
    ],
  };
}

/** Share button that opens Telegram's native share sheet with the referral link. */
export function inviteKeyboard(referralLink: string): InlineKeyboardMarkup {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
  return { inline_keyboard: [[{ text: '📤 SHARE INVITE LINK', url: shareUrl }]] };
}

/** Admin preview buttons. */
export function previewKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🚀 PUBLISH', callback_data: 'wiz:publish' }],
      [
        { text: '✏️ EDIT', callback_data: 'wiz:edit' },
        { text: '❌ CANCEL', callback_data: 'wiz:cancel' },
      ],
    ],
  };
}
