// One place for app-level constants. Rename, change currency, etc.
export const APP = { name: 'Hisaab', currency: 'INR', locale: 'en-IN', defaultHue: 200 };
export const FUND_TYPES = {
  own:    { label: 'Yours',           hint: 'Your own day-to-day money' },
  goal:   { label: 'Goals',           hint: 'Saving towards something' },
  invest: { label: 'Investments',     hint: 'Money put to work (balance only)' },
  held:   { label: 'Held for others', hint: 'Money you manage on someone’s behalf' },
};
export const GENERAL_ID = 'cat-general';
export const DEFAULT_CATEGORIES = ['General', 'Food', 'Travel', 'Books', 'Bills', 'Health', 'Family', 'Other'];
