import type { InlineKeyboardButton, InlineKeyboardMarkup } from './types';

/** Minimal shape needed to label a giveaway in the delete picker. */
interface GiveawayPick {
  id: number;
  title: string;
  status: string;
}

const STATUS_ICON: Record<string, string> = {
  active: '🟢',
  awaiting_draw: '⏳',
  ended: '🔒',
  draft: '📝',
};

/** Picker list: one button per giveaway → confirm delete (delpick:<id>). */
export function deleteListKeyboard(giveaways: GiveawayPick[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = giveaways.map((g) => {
    const icon = STATUS_ICON[g.status] ?? '•';
    const title = g.title.length > 30 ? g.title.slice(0, 29) + '…' : g.title;
    return [{ text: `${icon} #${g.id} ${title}`, callback_data: `delpick:${g.id}` }];
  });
  rows.push([{ text: '⬅️ Kembali', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
}

/** Confirm buttons for deleting a specific picked giveaway (back → list). */
export function deletePickConfirmKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🗑 Ya, hapus', callback_data: `delcfm:${giveawayId}` }],
      [{ text: '⬅️ Kembali ke daftar', callback_data: 'menu:dellist' }],
    ],
  };
}

/** Confirm/cancel buttons for the destructive /delete command. */
export function deleteConfirmKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🗑 Ya, hapus', callback_data: `delcfm:${giveawayId}` }],
      [{ text: '↩️ Batal', callback_data: `delx:${giveawayId}` }],
    ],
  };
}

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
    rows.push([{ text: '🗑 Hapus Giveaway', callback_data: 'menu:dellist' }]);
  }
  return { inline_keyboard: rows };
}

/** Single "back to main menu" button. */
export function backKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu:home' }]] };
}

/** In-menu giveaway view: JOIN + back (+ admin delete for the shown one). */
export function activeMenuKeyboard(giveawayId: number, admin = false): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '🎉 JOIN GIVEAWAY', callback_data: `join:${giveawayId}` }],
  ];
  if (admin) rows.push([{ text: '🗑 Hapus Giveaway Ini', callback_data: `delpick:${giveawayId}` }]);
  rows.push([{ text: '⬅️ Kembali', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
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

/**
 * JOIN button for a CHANNEL post. This is a CALLBACK button (cjoin:<id>) so the
 * bot handles the tap itself: already-registered users get a popup + DM without
 * being bounced out of the channel; only brand-new users are redirected into
 * the bot (via answerCallbackQuery's url) so it can DM them afterwards.
 */
export function channelJoinKeyboard(giveawayId: number): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '🎉 IKUT GIVEAWAY', callback_data: `cjoin:${giveawayId}` }]] };
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

/** Preview EDIT → pick a single field to fix (returns to preview after). */
export function wizardFieldsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📝 Judul', callback_data: 'wiz:field:title' },
        { text: '📄 Deskripsi', callback_data: 'wiz:field:description' },
      ],
      [
        { text: '🎁 Prize', callback_data: 'wiz:field:prize' },
        { text: '🏆 Winners', callback_data: 'wiz:field:winners_count' },
      ],
      [
        { text: '📢 Channel', callback_data: 'wiz:field:required_channel' },
        { text: '📅 Deadline', callback_data: 'wiz:field:deadline' },
      ],
      [
        { text: '🎟 Max Bonus', callback_data: 'wiz:field:max_referral_bonus' },
        { text: '🖼 Gambar', callback_data: 'wiz:field:image' },
      ],
      [{ text: '🚀 Tujuan Publish', callback_data: 'wiz:field:publish_dest' }],
      [{ text: '⬅️ Kembali ke preview', callback_data: 'wiz:preview' }],
    ],
  };
}

/** Buttons under each wizard step prompt: back one step (if allowed) + cancel. */
export function wizardStepKeyboard(canBack: boolean): InlineKeyboardMarkup {
  const row: InlineKeyboardButton[] = [];
  if (canBack) row.push({ text: '⬅️ Kembali', callback_data: 'wiz:back' });
  row.push({ text: '❌ Batal', callback_data: 'wiz:cancel' });
  return { inline_keyboard: [row] };
}

/** Buttons under a single-field edit prompt: cancel → back to preview. */
export function wizardEditFieldKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '⬅️ Batal, kembali ke preview', callback_data: 'wiz:preview' }]],
  };
}
