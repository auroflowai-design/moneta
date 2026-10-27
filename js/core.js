/*
 * Moneta core
 * Pure, framework-free business rules shared by the browser app and the tests.
 *
 * Money is stored as a canonical decimal string ("1234.56") and every
 * calculation runs on integer minor units (BigInt). Floating point is never
 * used for a journal total or a comparison.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MonetaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP_ID = 'moneta';
  const SCHEMA_VERSION = 3;
  const BACKUP_FORMAT_VERSION = 3;
  const ZERO = '0.00';
  const MAX_MINOR = 999999999999999n; // 9,999,999,999,999.99
  const MIN_DATE = '1900-01-01';
  const MAX_DATE = '2100-12-31';

  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const CURRENCIES = [
    { code: 'INR', label: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
    { code: 'USD', label: 'US Dollar', symbol: '$', locale: 'en-US' },
    { code: 'EUR', label: 'Euro', symbol: '€', locale: 'de-DE' },
    { code: 'GBP', label: 'British Pound', symbol: '£', locale: 'en-GB' },
    { code: 'JPY', label: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
    { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$', locale: 'en-CA' },
    { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
    { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ', locale: 'ar-AE' },
    { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG' }
  ];

  const DATE_FORMATS = [
    { value: 'dd-mmm-yyyy', label: '26 Oct 2026', example: 'dd-mmm-yyyy' },
    { value: 'dd/mm/yyyy', label: '26/10/2026', example: 'dd/mm/yyyy' },
    { value: 'mm/dd/yyyy', label: '10/26/2026', example: 'mm/dd/yyyy' },
    { value: 'yyyy-mm-dd', label: '2026-10-26', example: 'yyyy-mm-dd' }
  ];

  const SORT_OPTIONS = [
    { value: 'date-desc', label: 'Date · newest first', key: 'date', dir: 'desc' },
    { value: 'date-asc', label: 'Date · oldest first', key: 'date', dir: 'asc' },
    { value: 'debit-desc', label: 'Debit · high to low', key: 'debit', dir: 'desc' },
    { value: 'debit-asc', label: 'Debit · low to high', key: 'debit', dir: 'asc' },
    { value: 'credit-desc', label: 'Credit · high to low', key: 'credit', dir: 'desc' },
    { value: 'credit-asc', label: 'Credit · low to high', key: 'credit', dir: 'asc' },
    { value: 'particulars-asc', label: 'Particulars · A to Z', key: 'particulars', dir: 'asc' },
    { value: 'particulars-desc', label: 'Particulars · Z to A', key: 'particulars', dir: 'desc' }
  ];

  const PERIOD_OPTIONS = [
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'this-quarter', label: 'This quarter' },
    { value: 'this-year', label: 'This calendar year' },
    { value: 'fy', label: 'This financial year' },
    { value: 'last-30', label: 'Last 30 days' },
    { value: 'last-90', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
    { value: 'custom', label: 'Custom range' }
  ];

  const PAGE_SIZES = [25, 50, 100];

  const DEFAULT_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'food', name: 'Food & Dining' }),
    Object.freeze({ id: 'shopping', name: 'Shopping & Lifestyle' }),
    Object.freeze({ id: 'transport', name: 'Transport' }),
    Object.freeze({ id: 'bills', name: 'Bills & Utilities' }),
    Object.freeze({ id: 'health', name: 'Health & Wellness' }),
    Object.freeze({ id: 'income', name: 'Income' }),
    Object.freeze({ id: 'other', name: 'Other' })
  ]);

  const CATEGORIES = DEFAULT_CATEGORIES.map((category) => category.name);
  const CATEGORY_LIMITS = Object.freeze({ min: 5, max: 7 });

  const LEGACY_CATEGORY_IDS = Object.freeze({
    'food & dining': 'food',
    groceries: 'food',
    'bills & utilities': 'bills',
    transport: 'transport',
    health: 'health',
    'personal care': 'shopping',
    education: 'shopping',
    entertainment: 'shopping',
    travel: 'shopping',
    rent: 'bills',
    salary: 'income',
    investments: 'income',
    insurance: 'bills',
    business: 'income',
    'fees & charges': 'bills',
    taxes: 'bills',
    'cash & atm': 'other',
    shopping: 'shopping',
    'other income': 'income',
    transfers: 'other',
    adjustments: 'other',
    uncategorised: 'other',
    uncategorized: 'other'
  });

  // A compact, transparent categoriser for sheets that do not carry a
  // category column. Merchant terms come before generic banking terms, so
  // "UPI/SWIGGY" becomes Food & Dining rather than Other.
  const CATEGORY_RULES = [
    {
      id: 'food',
      terms: [
        'swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'dominos', 'pizza', 'bakery',
        'food', 'hotel mess', 'canteen', 'chai', 'barbeque', 'bbq', 'dhaba', 'eatery',
        'samosa', 'burger', 'noodles', 'momos', 'manchurian', 'ice cream', 'pastry',
        'cake', 'gulab jamun', 'butterscotch', 'mithai', 'sweets', 'biscuit', 'biscuits',
        'namkeen', 'chips', 'cold drink', 'soft drink', 'pepsi', 'maza', 'bar one',
        'munch', 'saunf', 'paneer', 'pakode', 'pakora', 'freshers party', 'snack',
        'bigbasket', 'blinkit', 'zepto', 'dmart', 'd mart', 'grocery', 'groceries',
        'supermarket', 'kirana', 'instamart', 'reliance smart', 'vegetables', 'vegetable',
        'sabji', 'bhindi', 'onion', 'piyaz', 'pyaz', 'garlic', 'tomato', 'mango',
        'apple', 'fruit', 'milk', 'dairy', 'bread', 'oregano', 'provision', 'atta',
        'aata', 'chawal', 'basmati', 'rice', 'sugar', 'shakar', 'brown sugar', 'oil',
        'masala', 'tokri'
      ]
    },
    {
      id: 'bills',
      terms: [
        'electricity', 'electric bill', 'recharge', 'broadband', 'airtel', 'jio',
        'vodafone', 'bill payment', 'gas bill', 'water bill', 'postpaid', 'dth',
        'utility', 'cylinder', 'gas agency', 'lpg', 'data top up', 'data topup',
        'network', 'sky bridge', 'bjili', 'bijli', 'house rent', 'rent payment',
        'landlord', 'lease', 'rent', 'insurance', 'policy premium', 'lic premium',
        'mediclaim', 'charges', 'charge', 'penalty', 'late fee', 'annual fee',
        'processing fee', 'gst', 'interest charged', 'emi', 'licence', 'license',
        'challan', 'fine', 'income tax', 'advance tax', 'tds', 'property tax',
        'tax payment'
      ]
    },
    {
      id: 'transport',
      terms: [
        'uber', 'ola', 'rapido', 'metro', 'irctc', 'petrol', 'diesel', 'fuel', 'hpcl',
        'bpcl', 'iocl', 'shell', 'fastag', 'toll', 'parking', 'auto rickshaw', 'cab',
        'bus ticket', 'bus fare', 'car body', 'car cover'
      ]
    },
    {
      id: 'health',
      terms: [
        'pharmacy', 'apollo', 'medical', 'hospital', 'clinic', 'doctor', 'health',
        'diagnostic', 'medplus', 'wellness', 'medicine', 'tablet', 'dettol', 'napkin',
        'sanitary'
      ]
    },
    {
      id: 'shopping',
      terms: [
        'haircut', 'salon', 'barber', 'shampoo', 'soap', 'grooming', 'personal care',
        'beauty', 'school', 'college', 'cllg', 'university', 'course', 'udemy',
        'coursera', 'tuition', 'exam fee', 'education', 'books', 'book', 'admission',
        'printout', 'photostat', 'photo print', 'stationery', 'netflix', 'prime video',
        'hotstar', 'spotify', 'youtube', 'bookmyshow', 'cinema', 'gaming',
        'entertainment', 'make my trip', 'makemytrip', 'goibibo', 'cleartrip', 'flight',
        'airlines', 'airport', 'booking com', 'resort', 'travel', 'amazon', 'flipkart',
        'myntra', 'ajio', 'meesho', 'decathlon', 'lifestyle', 'shopping', 'mall',
        'retail', 'amartex', 'clothes', 'clothing', 'pant', 'shirt', 'suit', 'tshirt',
        't-shirt', 'lower', 'mobile cover', 'laptop battery', 'inverter', 'ups repair',
        'repair', 'three pin plug', 'plug'
      ]
    },
    {
      id: 'income',
      terms: [
        'salary', 'payroll', 'stipend', 'wages', 'mutual fund', 'sip', 'zerodha',
        'groww', 'upstox', 'demat', 'dividend', 'investment', 'business', 'invoice',
        'client payment', 'professional fee', 'gst payment', 'money received',
        'refund', 'cashback', 'cash back', 'interest credited', 'interest credit',
        'interest'
      ]
    },
    {
      id: 'other',
      terms: [
        'atm', 'cash withdrawal', 'cash deposit', 'cash', 'upi', 'neft', 'imps',
        'rtgs', 'fund transfer', 'self transfer', 'transfer', 'money sent',
        'money sent to', 'gave money', 'remaining money', 'savings acc',
        'savings account', 'amrit', 'khushi', 'harpreet', 'rahul', 'sahil', 'shakti',
        'dad', 'mummy', 'previous balance', 'opening balance', 'balance b/f',
        'balance bf', 'brought forward'
      ]
    }
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    currency: 'INR',
    dateFormat: 'dd-mmm-yyyy',
    theme: 'system',
    defaultSort: 'date-desc',
    pageSize: 25,
    openingBalance: '0.00',
    openingBalanceSide: 'credit',
    goalName: 'Rainy day fund',
    goalTarget: '0.00',
    monthlyBudget: '0.00',
    accountName: 'Main journal account',
    accountType: 'Cash & bank',
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category }))
  });

  const SOURCES = ['manual', 'import', 'legacy', 'backup', 'duplicate'];

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayISO(now) {
    return toISODate(now instanceof Date ? now : new Date());
  }

  function parseISODateParts(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function isValidISODate(value) {
    return !!parseISODateParts(value);
  }

  function formatDate(value, format) {
    const parts = parseISODateParts(value);
    if (!parts) return value || '—';
    const monthShort = MONTHS_SHORT[parts.month - 1];
    switch (format || DEFAULT_SETTINGS.dateFormat) {
      case 'dd/mm/yyyy':
        return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
      case 'mm/dd/yyyy':
        return `${pad2(parts.month)}/${pad2(parts.day)}/${parts.year}`;
      case 'yyyy-mm-dd':
        return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
      case 'dd-mmm-yyyy':
      default:
        return `${pad2(parts.day)} ${monthShort} ${parts.year}`;
    }
  }

  function formatLongDate(value) {
    const parts = parseISODateParts(value);
    if (!parts) return value || '—';
    return `${parts.day} ${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
  }

  function formatMonthLabel(year, month) {
    return `${MONTHS_SHORT[month - 1]} ${String(year).slice(-2)}`;
  }

  function formatRangeLabel(from, to, format) {
    if (!from && !to) return 'All time';
    if (from && to && from === to) return formatDate(from, format);
    if (!from) return `Until ${formatDate(to, format)}`;
    if (!to) return `From ${formatDate(from, format)}`;
    const a = parseISODateParts(from);
    const b = parseISODateParts(to);
    if (!a || !b) return `${from} – ${to}`;
    const short = (p) => `${pad2(p.day)} ${MONTHS_SHORT[p.month - 1]}`;
    if (a.year === b.year) {
      return `${short(a)} – ${formatDate(to, format)}`;
    }
    return `${formatDate(from, format)} – ${formatDate(to, format)}`;
  }

  function addDaysISO(value, days) {
    const parts = parseISODateParts(value);
    if (!parts) return value;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function startOfMonthISO(value) {
    const parts = parseISODateParts(value);
    if (!parts) return value;
    return `${parts.year}-${pad2(parts.month)}-01`;
  }

  function endOfMonthISO(value) {
    const parts = parseISODateParts(value);
    if (!parts) return value;
    const date = new Date(Date.UTC(parts.year, parts.month, 0));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function monthKey(value) {
    const parts = parseISODateParts(value);
    return parts ? `${parts.year}-${pad2(parts.month)}` : '';
  }

  function compareISO(a, b) {
    return String(a || '').localeCompare(String(b || ''));
  }

  function daysBetween(from, to) {
    const a = parseISODateParts(from);
    const b = parseISODateParts(to);
    if (!a || !b) return 0;
    const start = Date.UTC(a.year, a.month - 1, a.day);
    const end = Date.UTC(b.year, b.month - 1, b.day);
    return Math.round((end - start) / 86400000);
  }

  function weekdayIndex(value) {
    const parts = parseISODateParts(value);
    if (!parts) return null;
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  }

  function quarterStartISO(value) {
    const parts = parseISODateParts(value);
    if (!parts) return value;
    const month = Math.floor((parts.month - 1) / 3) * 3 + 1;
    return `${parts.year}-${pad2(month)}-01`;
  }

  function quarterEndISO(value) {
    const parts = parseISODateParts(value);
    if (!parts) return value;
    const month = Math.floor((parts.month - 1) / 3) * 3 + 1;
    const date = new Date(Date.UTC(parts.year, month + 2, 0));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function financialYearRange(value) {
    const parts = parseISODateParts(value);
    if (!parts) return { from: value, to: value };
    // Indian financial year: 1 April – 31 March.
    const startYear = parts.month >= 4 ? parts.year : parts.year - 1;
    return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
  }

  function computePeriodRange(preset, options) {
    const opts = options || {};
    const anchor = isValidISODate(opts.today) ? opts.today : todayISO();
    let from = null;
    let to = null;
    let label = 'This month';
    const option = PERIOD_OPTIONS.find((item) => item.value === preset) || PERIOD_OPTIONS[0];
    label = option.label;
    switch (option.value) {
      case 'last-month': {
        const parts = parseISODateParts(anchor);
        const d = new Date(Date.UTC(parts.year, parts.month - 2, 1));
        const end = new Date(Date.UTC(parts.year, parts.month - 1, 0));
        from = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
        to = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
        break;
      }
      case 'this-quarter':
        from = quarterStartISO(anchor);
        to = quarterEndISO(anchor);
        break;
      case 'this-year': {
        const parts = parseISODateParts(anchor);
        from = `${parts.year}-01-01`;
        to = `${parts.year}-12-31`;
        break;
      }
      case 'fy': {
        const range = financialYearRange(anchor);
        from = range.from;
        to = range.to;
        break;
      }
      case 'last-30':
        from = addDaysISO(anchor, -29);
        to = anchor;
        break;
      case 'last-90':
        from = addDaysISO(anchor, -89);
        to = anchor;
        break;
      case 'all':
        from = null;
        to = null;
        break;
      case 'custom': {
        const a = isValidISODate(opts.customFrom) ? opts.customFrom : null;
        const b = isValidISODate(opts.customTo) ? opts.customTo : null;
        from = a;
        to = b;
        if (from && to && from > to) {
          const swap = from;
          from = to;
          to = swap;
        }
        break;
      }
      case 'this-month':
      default:
        from = startOfMonthISO(anchor);
        to = endOfMonthISO(anchor);
        break;
    }
    return { preset: option.value, from, to, label };
  }

  function dateSearchVariants(value, dateFormat) {
    const parts = parseISODateParts(value);
    if (!parts) return '';
    const dd = pad2(parts.day);
    const mm = pad2(parts.month);
    const yyyy = String(parts.year);
    return [
      value,
      `${dd}/${mm}/${yyyy}`,
      `${mm}/${dd}/${yyyy}`,
      `${dd}-${mm}-${yyyy}`,
      `${dd} ${MONTHS_SHORT[parts.month - 1].toLowerCase()} ${yyyy}`,
      `${MONTHS_SHORT[parts.month - 1].toLowerCase()} ${yyyy}`,
      `${MONTHS_LONG[parts.month - 1].toLowerCase()} ${yyyy}`,
      `${WEEKDAYS_SHORT[weekdayIndex(value)].toLowerCase()} ${dd}`,
      formatDate(value, dateFormat),
      formatLongDate(value)
    ].join(' ').toLowerCase();
  }

  /* ------------------------------------------------------------------ money */

  function canonicalFromMinor(minor) {
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const integer = abs / 100n;
    const fraction = abs % 100n;
    return `${negative ? '-' : ''}${integer.toString()}.${pad2(fraction.toString())}`;
  }

  function parseMoney(input, options) {
    const opts = options || {};
    if (input === null || input === undefined || input === '') {
      return opts.blankZero === false
        ? { ok: false, error: 'Enter an amount' }
        : { ok: true, value: ZERO, minor: 0n, blank: true };
    }
    let minor;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) return { ok: false, error: 'Enter a valid amount' };
      if (input < 0) return { ok: false, error: 'Amount cannot be negative' };
      const scaled = input * 100;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-5) {
        return { ok: false, error: 'Use no more than 2 decimal places' };
      }
      minor = BigInt(Math.round(scaled));
    } else {
      let text = String(input).trim();
      if (!text) return { ok: true, value: ZERO, minor: 0n, blank: true };
      if (/^\(.*\)$/.test(text) || /^[-−]/.test(text)) {
        return { ok: false, error: 'Amount cannot be negative' };
      }
      if (text.startsWith('+')) text = text.slice(1);
      text = text
        .replace(/[,\s\u00a0]/g, '')
        .replace(/(?:INR|USD|EUR|GBP|JPY|CAD|AUD|AED|SGD)$/i, '')
        .replace(/[₹$€£¥]/g, '');
      text = text.replace(/^(?:INR|USD|EUR|GBP|JPY|CAD|AUD|AED|SGD)/i, '');
      text = text.replace(/(?:dr|cr)$/i, '');
      if (!/^\d+(?:\.\d+)?$/.test(text)) {
        return { ok: false, error: 'Enter a valid amount' };
      }
      const pieces = text.split('.');
      const integer = pieces[0].replace(/^0+(?=\d)/, '');
      const fraction = pieces[1] || '';
      if (fraction.length > 2) {
        return { ok: false, error: 'Use no more than 2 decimal places' };
      }
      if (integer.length > 13) {
        return { ok: false, error: 'Amount is too large' };
      }
      minor = BigInt(integer) * 100n + BigInt((fraction + '00').slice(0, 2));
    }
    if (minor > MAX_MINOR) return { ok: false, error: 'Amount is too large' };
    return { ok: true, value: canonicalFromMinor(minor), minor, blank: false };
  }

  // Computed journal values (a net movement, a negative account balance) can
  // be signed. parseMoney deliberately rejects user-entered negatives, so
  // peel the sign off first and keep the validation rules for the magnitude.
  function parseSignedMinor(value) {
    if (typeof value === 'bigint') {
      return { ok: true, minor: value < 0n ? -value : value, negative: value < 0n };
    }
    let text = String(value === null || value === undefined ? '' : value).trim();
    let negative = false;
    if (/^\(.*\)$/.test(text)) {
      negative = true;
      text = text.slice(1, -1).trim();
    }
    if (/^[-\u2212]/.test(text)) {
      negative = true;
      text = text.slice(1).trim();
    }
    const parsed = parseMoney(text);
    return { ok: parsed.ok, minor: parsed.ok ? parsed.minor : 0n, negative: negative && parsed.ok };
  }

  function moneyMinor(value) {
    if (typeof value === 'bigint') return value;
    if (value === null || value === undefined || value === '') return 0n;
    const parsed = parseSignedMinor(value);
    if (!parsed.ok) return 0n;
    return parsed.negative ? -parsed.minor : parsed.minor;
  }

  function addMoney(a, b) {
    return canonicalFromMinor(moneyMinor(a) + moneyMinor(b));
  }

  function subtractMoney(a, b) {
    return canonicalFromMinor(moneyMinor(a) - moneyMinor(b));
  }

  function negateMoney(value) {
    return canonicalFromMinor(-moneyMinor(value));
  }

  function compareMoney(a, b) {
    const x = moneyMinor(a);
    const y = moneyMinor(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }

  function isZeroMoney(value) {
    return moneyMinor(value) === 0n;
  }

  function sumField(rows, field) {
    let total = 0n;
    for (const row of rows || []) total += moneyMinor(row[field]);
    return canonicalFromMinor(total);
  }

  function summarize(rows) {
    let debit = 0n;
    let credit = 0n;
    for (const row of rows || []) {
      debit += moneyMinor(row.debit);
      credit += moneyMinor(row.credit);
    }
    return {
      count: (rows || []).length,
      debit: canonicalFromMinor(debit),
      credit: canonicalFromMinor(credit),
      net: canonicalFromMinor(credit - debit)
    };
  }

  function netMovement(rows) {
    return summarize(rows).net;
  }

  function openingBalanceMinor(settings) {
    const amount = moneyMinor(settings && settings.openingBalance);
    return settings && settings.openingBalanceSide === 'debit' ? -amount : amount;
  }

  function accountMovement(rows) {
    let movement = 0n;
    for (const row of rows || []) {
      movement += moneyMinor(row.credit) - moneyMinor(row.debit);
    }
    return canonicalFromMinor(movement);
  }

  function accountBalance(rows, settings) {
    let balance = openingBalanceMinor(settings);
    for (const row of rows || []) {
      balance += moneyMinor(row.credit) - moneyMinor(row.debit);
    }
    return canonicalFromMinor(balance);
  }

  function formatAmount(value, options) {
    const opts = options || {};
    const currency = currencyInfo(opts.currency);
    const parsed = parseSignedMinor(value);
    const amount = parsed.ok ? Number(parsed.minor) / 100 * (parsed.negative ? -1 : 1) : 0;
    return new Intl.NumberFormat(opts.locale || currency.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function formatMoney(value, options) {
    const opts = options || {};
    const currency = currencyInfo(opts.currency);
    const parsed = parseSignedMinor(value);
    const amount = parsed.ok ? Number(parsed.minor) / 100 * (parsed.negative ? -1 : 1) : 0;
    return new Intl.NumberFormat(opts.locale || currency.locale, {
      style: 'currency',
      currency: currency.code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function formatCompactMoney(value, options) {
    const opts = options || {};
    const currency = currencyInfo(opts.currency);
    const parsed = parseSignedMinor(value);
    const amount = parsed.ok ? Number(parsed.minor) / 100 * (parsed.negative ? -1 : 1) : 0;
    return new Intl.NumberFormat(opts.locale || currency.locale, {
      style: 'currency',
      currency: currency.code,
      currencyDisplay: 'narrowSymbol',
      notation: Math.abs(amount) >= 100000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(amount) >= 100000 ? 1 : 2,
      minimumFractionDigits: Math.abs(amount) >= 100000 ? 0 : 2
    }).format(amount);
  }

  function currencyInfo(code) {
    return CURRENCIES.find((item) => item.code === code) || CURRENCIES[0];
  }

  function currencySymbol(code) {
    return currencyInfo(code).symbol;
  }

  function percent(part, total) {
    const p = Number(parseMoney(part).value || 0);
    const t = Number(parseMoney(total).value || 0);
    if (!t) return 0;
    return Math.round((p / t) * 1000) / 10;
  }

  /* --------------------------------------------------------------- settings */

  function normalizeSettings(input, options) {
    const opts = options || {};
    const source = input && typeof input === 'object' ? input : {};
    const errors = [];
    const settings = { ...DEFAULT_SETTINGS };
    const oneOf = (value, list) => list.some((item) => (typeof item === 'string' ? item === value : item.value === value));

    if (source.currency !== undefined) {
      if (oneOf(source.currency, CURRENCIES.map((item) => item.code))) settings.currency = source.currency;
      else errors.push('Unknown display currency.');
    }
    if (source.dateFormat !== undefined) {
      if (oneOf(source.dateFormat, DATE_FORMATS)) settings.dateFormat = source.dateFormat;
      else errors.push('Unknown date format.');
    }
    if (source.theme !== undefined) {
      if (oneOf(source.theme, ['system', 'light', 'dark'])) settings.theme = source.theme;
      else errors.push('Unknown theme.');
    }
    if (source.defaultSort !== undefined) {
      if (oneOf(source.defaultSort, SORT_OPTIONS)) settings.defaultSort = source.defaultSort;
      else errors.push('Unknown default sort.');
    }
    if (source.pageSize !== undefined) {
      if (PAGE_SIZES.includes(Number(source.pageSize))) settings.pageSize = Number(source.pageSize);
      else errors.push('Unknown page size.');
    }
    if (source.openingBalance !== undefined) {
      const parsed = parseMoney(source.openingBalance);
      if (parsed.ok) settings.openingBalance = parsed.value;
      else errors.push('Opening balance is invalid.');
    }
    if (source.openingBalanceSide !== undefined) {
      if (source.openingBalanceSide === 'credit' || source.openingBalanceSide === 'debit') {
        settings.openingBalanceSide = source.openingBalanceSide;
      } else {
        errors.push('Unknown opening balance side.');
      }
    }
    if (source.goalName !== undefined) {
      const name = normalizeText(source.goalName).slice(0, 60);
      settings.goalName = name || DEFAULT_SETTINGS.goalName;
    }
    if (source.goalTarget !== undefined) {
      const parsed = parseMoney(source.goalTarget);
      if (parsed.ok) settings.goalTarget = parsed.value;
      else errors.push('Savings goal target is invalid.');
    }
    if (source.monthlyBudget !== undefined) {
      const parsed = parseMoney(source.monthlyBudget);
      if (parsed.ok) settings.monthlyBudget = parsed.value;
      else errors.push('Monthly budget is invalid.');
    }
    if (source.accountName !== undefined) {
      const name = normalizeText(source.accountName).slice(0, 60);
      settings.accountName = name || DEFAULT_SETTINGS.accountName;
    }
    if (source.accountType !== undefined) {
      if (oneOf(source.accountType, ['Cash & bank', 'Cash', 'Bank', 'Savings', 'Card', 'Other'])) {
        settings.accountType = source.accountType;
      } else {
        errors.push('Unknown account type.');
      }
    }
    if (source.categories !== undefined) {
      settings.categories = normalizeCategoryList(source.categories);
    }
    if (errors.length && opts.strict) return { ok: false, errors, settings };
    return { ok: true, errors: [], settings };
  }

  function inferCategory(particulars, categories) {
    const list = normalizeCategoryList(categories);
    const id = inferCategoryId(particulars);
    const matched = list.find((category) => category.id === id);
    if (matched) return matched.name;
    const fallback = list.find((category) => category.id === 'other') || list[list.length - 1];
    return fallback ? fallback.name : 'Other';
  }

  /* ----------------------------------------------------------- transactions */

  function newId(prefix) {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return `${prefix || 'tx'}_${cryptoObject.randomUUID()}`;
    }
    return `${prefix || 'tx'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeText(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function categorySlug(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'category';
  }

  function normalizeCategoryList(value) {
    const source = Array.isArray(value) ? value : [];
    if (!source.length) return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    const list = [];
    for (const entry of source) {
      const name = normalizeText(typeof entry === 'string' ? entry : entry && entry.name).slice(0, 40);
      if (!name) continue;
      if (list.some((category) => category.name.toLowerCase() === name.toLowerCase())) continue;
      let id = normalizeText(entry && typeof entry === 'object' ? entry.id : '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
      if (!id) id = LEGACY_CATEGORY_IDS[name.toLowerCase()] || categorySlug(name);
      let candidate = id;
      let suffix = 2;
      while (list.some((category) => category.id === candidate)) candidate = `${id}-${suffix++}`;
      list.push({ id: candidate, name });
      if (list.length >= CATEGORY_LIMITS.max) break;
    }
    if (!list.length) return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    for (const category of DEFAULT_CATEGORIES) {
      if (list.length >= CATEGORY_LIMITS.min) break;
      if (!list.some((item) => item.id === category.id || item.name.toLowerCase() === category.name.toLowerCase())) {
        list.push({ ...category });
      }
    }
    return list;
  }

  function categoryNames(value) {
    return normalizeCategoryList(value).map((category) => category.name);
  }

  function inferCategoryId(particulars) {
    const text = normalizeText(particulars).toLowerCase();
    if (!text) return 'other';
    for (const rule of CATEGORY_RULES) {
      if (rule.terms.some((term) => text.includes(term))) return rule.id;
    }
    return 'other';
  }

  function resolveCategory(value, particulars, categories) {
    const list = normalizeCategoryList(categories);
    const supplied = normalizeText(value);
    if (supplied) {
      const direct = list.find((category) => category.name.toLowerCase() === supplied.toLowerCase());
      if (direct) return direct.name;
      const legacyId = LEGACY_CATEGORY_IDS[supplied.toLowerCase()];
      if (legacyId) {
        const mapped = list.find((category) => category.id === legacyId);
        if (mapped) return mapped.name;
      }
      const slug = categorySlug(supplied);
      const byId = list.find((category) => category.id === slug);
      if (byId) return byId.name;
    }
    const inferredId = inferCategoryId(particulars);
    const inferred = list.find((category) => category.id === inferredId);
    if (inferred) return inferred.name;
    const fallback = list.find((category) => category.id === 'other')
      || list.find((category) => /other/i.test(category.name))
      || list[list.length - 1];
    return fallback ? fallback.name : 'Other';
  }

  function normalizeTransaction(input, options) {
    const opts = options || {};
    const source = input && typeof input === 'object' ? input : {};
    const errors = {};
    const date = normalizeText(source.date);
    const particulars = normalizeText(source.particulars !== undefined ? source.particulars : source.description);
    const category = resolveCategory(source.category, particulars, opts.categories);
    if (!isValidISODate(date)) errors.date = 'Choose a valid date';
    if (!particulars) errors.particulars = 'Add particulars';
    else if (particulars.length > 240) errors.particulars = 'Keep particulars under 240 characters';

    const debit = parseMoney(source.debit === undefined ? 0 : source.debit);
    const credit = parseMoney(source.credit === undefined ? 0 : source.credit);
    if (!debit.ok) errors.debit = debit.error;
    if (!credit.ok) errors.credit = credit.error;
    if (debit.ok && credit.ok) {
      const d = debit.minor;
      const c = credit.minor;
      // A statement can legitimately carry both sides on one line (for
      // example a contra transfer or a brought-forward balance). Keep both
      // amounts instead of silently losing data; only an empty line fails.
      if (d === 0n && c === 0n) errors.amount = 'Enter a debit or credit amount';
    }

    const id = opts.requireId
      ? normalizeText(source.id)
      : normalizeText(source.id) || newId();
    if (opts.requireId && !id) errors.id = 'Missing transaction id';
    if (id && id.length > 120) errors.id = 'Invalid transaction id';

    const now = opts.now || new Date().toISOString();
    const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : now;
    const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt;
    const txSource = SOURCES.includes(source.source) ? source.source : (opts.source || 'manual');
    const value = {
      id,
      date,
      particulars,
      category,
      debit: debit.ok ? debit.value : ZERO,
      credit: credit.ok ? credit.value : ZERO,
      createdAt,
      updatedAt,
      source: txSource
    };
    if (source.importBatchId) value.importBatchId = normalizeText(source.importBatchId).slice(0, 120);
    if (source.sourceRowNumber !== undefined && Number.isFinite(Number(source.sourceRowNumber))) {
      value.sourceRowNumber = Number(source.sourceRowNumber);
    }
    if (source.sourceFileName) value.sourceFileName = normalizeText(source.sourceFileName).slice(0, 200);

    const ok = Object.keys(errors).length === 0;
    return { ok, errors, value };
  }

  function transactionFromLegacy(item, index) {
    if (!item || typeof item !== 'object') return null;
    const amount = parseMoney(item.amount);
    if (!amount.ok || amount.minor === 0n) return null;
    const date = isValidISODate(item.date) ? item.date : null;
    if (!date) return null;
    const credit = item.type === 'income';
    const createdAt = item.createdAt
      ? new Date(Number(item.createdAt)).toISOString()
      : new Date().toISOString();
    const particulars = normalizeText(item.description || item.category || 'Imported entry');
    return {
      id: item.id ? String(item.id) : `legacy_${Date.now()}_${index}`,
      date,
      particulars,
      category: resolveCategory(item.category, particulars),
      debit: credit ? ZERO : amount.value,
      credit: credit ? amount.value : ZERO,
      createdAt,
      updatedAt: createdAt,
      source: 'legacy'
    };
  }

  function duplicateKey(transaction) {
    return [
      transaction.date,
      normalizeText(transaction.particulars).toLowerCase(),
      parseMoney(transaction.debit).value,
      parseMoney(transaction.credit).value
    ].join('|');
  }

  function transactionKeySet(transactions) {
    const set = new Set();
    for (const transaction of transactions || []) set.add(duplicateKey(transaction));
    return set;
  }

  function transactionKeyCounts(transactions) {
    const counts = new Map();
    for (const transaction of transactions || []) {
      const key = duplicateKey(transaction);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function sortedById(transactions) {
    return [...(transactions || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function sortTransactions(rows, key, direction) {
    const sortKey = ['date', 'particulars', 'debit', 'credit', 'createdAt'].includes(key) ? key : 'date';
    const factor = direction === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let result = 0;
      if (sortKey === 'particulars') {
        result = String(a.particulars || '').localeCompare(String(b.particulars || ''), 'en', { sensitivity: 'base' });
      } else if (sortKey === 'debit' || sortKey === 'credit') {
        result = compareMoney(a[sortKey], b[sortKey]);
      } else {
        result = compareISO(a.date, b.date);
        if (result === 0) result = compareISO(a.createdAt, b.createdAt);
      }
      if (result === 0) result = compareISO(a.createdAt, b.createdAt);
      if (result === 0) result = String(a.id || '').localeCompare(String(b.id || ''));
      return result * factor;
    });
  }

  function sortConfig(value) {
    return SORT_OPTIONS.find((option) => option.value === value) || SORT_OPTIONS[0];
  }

  function nextSortConfig(currentKey, currentDir, nextKey) {
    const key = ['date', 'particulars', 'debit', 'credit'].includes(nextKey) ? nextKey : 'date';
    const defaultDir = key === 'particulars' ? 'asc' : 'desc';
    if (currentKey === key) {
      return { key, dir: currentDir === 'asc' ? 'desc' : 'asc' };
    }
    return { key, dir: defaultDir };
  }

  function filterTransactions(rows, filters) {
    const f = filters || {};
    const search = normalizeText(f.search || '').toLowerCase();
    const dateFormat = f.dateFormat || DEFAULT_SETTINGS.dateFormat;
    return (rows || []).filter((row) => {
      if (f.from && row.date < f.from) return false;
      if (f.to && row.date > f.to) return false;
      if (f.side === 'debit' && moneyMinor(row.debit) === 0n) return false;
      if (f.side === 'credit' && moneyMinor(row.credit) === 0n) return false;
      if (f.category && f.category !== 'all') {
        const category = normalizeText(row.category) || 'Uncategorised';
        if (category !== f.category) return false;
      }
      if (!search) return true;
      const amountSearch = [
        row.debit,
        row.credit,
        formatAmount(row.debit, { currency: f.currency }),
        formatAmount(row.credit, { currency: f.currency })
      ].join(' ');
      const haystack = `${row.particulars} ${row.category || ''} ${row.date} ${dateSearchVariants(row.date, dateFormat)} ${amountSearch}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  function paginate(rows, page, pageSize) {
    const size = PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : DEFAULT_SETTINGS.pageSize;
    const total = (rows || []).length;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = clamp(Number(page) || 1, 1, pageCount);
    const startIndex = (current - 1) * size;
    return {
      rows: (rows || []).slice(startIndex, startIndex + size),
      page: current,
      pageCount,
      pageSize: size,
      total,
      start: total ? startIndex + 1 : 0,
      end: Math.min(startIndex + size, total)
    };
  }

  /* ---------------------------------------------------------------- reports */

  function topParticulars(rows, side, limit) {
    const field = side === 'credit' ? 'credit' : 'debit';
    const map = new Map();
    for (const row of rows || []) {
      const amount = moneyMinor(row[field]);
      if (amount === 0n) continue;
      const key = normalizeText(row.particulars).toLowerCase();
      if (!key) continue;
      const current = map.get(key) || { particulars: normalizeText(row.particulars), minor: 0n, count: 0 };
      current.minor += amount;
      current.count += 1;
      if (!current.particulars) current.particulars = normalizeText(row.particulars);
      map.set(key, current);
    }
    const total = map.size
      ? [...map.values()].reduce((sum, item) => sum + item.minor, 0n)
      : 0n;
    return [...map.values()]
      .sort((a, b) => {
        if (a.minor === b.minor) return a.particulars.localeCompare(b.particulars);
        return a.minor < b.minor ? 1 : -1;
      })
      .slice(0, limit || 8)
      .map((item) => ({
        particulars: item.particulars,
        amount: canonicalFromMinor(item.minor),
        count: item.count,
        share: total > 0n ? Math.round((Number(item.minor) / Number(total)) * 1000) / 10 : 0
      }));
  }

  function categoryBreakdown(rows, side, limit) {
    const field = side === 'credit' ? 'credit' : 'debit';
    const map = new Map();
    for (const row of rows || []) {
      const amount = moneyMinor(row[field]);
      if (amount === 0n) continue;
      const label = normalizeText(row.category) || 'Uncategorised';
      const key = label.toLowerCase();
      const current = map.get(key) || { category: label, minor: 0n, count: 0 };
      current.minor += amount;
      current.count += 1;
      map.set(key, current);
    }
    const total = map.size ? [...map.values()].reduce((sum, item) => sum + item.minor, 0n) : 0n;
    return [...map.values()]
      .sort((a, b) => (a.minor === b.minor ? a.category.localeCompare(b.category) : a.minor < b.minor ? 1 : -1))
      .slice(0, limit || 10)
      .map((item) => ({
        category: item.category,
        amount: canonicalFromMinor(item.minor),
        count: item.count,
        share: total > 0n ? Math.round((Number(item.minor) / Number(total)) * 1000) / 10 : 0
      }));
  }

  function largestEntries(rows, limit) {
    return [...(rows || [])]
      .map((row) => {
        const d = moneyMinor(row.debit);
        const c = moneyMinor(row.credit);
        return { row, side: d >= c ? 'debit' : 'credit', value: d >= c ? d : c };
      })
      .sort((a, b) => (a.value === b.value ? compareISO(b.row.date, a.row.date) : a.value < b.value ? 1 : -1))
      .slice(0, limit || 8)
      .map((item) => item.row);
  }

  function weekdayBreakdown(rows) {
    const buckets = WEEKDAYS_SHORT.map((label) => ({ label, debit: 0n, credit: 0n, count: 0 }));
    for (const row of rows || []) {
      const index = weekdayIndex(row.date);
      if (index === null) continue;
      buckets[index].debit += moneyMinor(row.debit);
      buckets[index].credit += moneyMinor(row.credit);
      buckets[index].count += 1;
    }
    return buckets.map((item) => ({
      label: item.label,
      debit: canonicalFromMinor(item.debit),
      credit: canonicalFromMinor(item.credit),
      count: item.count
    }));
  }

  function buildTrend(rows, range, dateFormat) {
    const f = range || {};
    const allRows = rows || [];
    let from = f.from;
    let to = f.to;
    if (!isValidISODate(from)) {
      const dates = allRows.map((row) => row.date).filter(isValidISODate).sort();
      from = dates[0] || todayISO();
    }
    if (!isValidISODate(to)) {
      const dates = allRows.map((row) => row.date).filter(isValidISODate).sort();
      to = dates[dates.length - 1] || todayISO();
    }
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    const filtered = allRows.filter((row) => row.date >= from && row.date <= to);
    const span = daysBetween(from, to) + 1;
    let granularity = 'monthly';
    if (span <= 31) granularity = 'daily';
    else if (span <= 120) granularity = 'weekly';

    const buckets = [];
    if (granularity === 'daily') {
      for (let date = from; date <= to; date = addDaysISO(date, 1)) {
        buckets.push({ key: date, label: String(parseISODateParts(date).day), title: formatLongDate(date), start: date, end: date });
      }
    } else if (granularity === 'weekly') {
      let cursor = from;
      while (cursor <= to) {
        const end = addDaysISO(cursor, 6) <= to ? addDaysISO(cursor, 6) : to;
        buckets.push({
          key: cursor,
          label: `${parseISODateParts(cursor).day} ${MONTHS_SHORT[parseISODateParts(cursor).month - 1]}`,
          title: `${formatDate(cursor, dateFormat)} – ${formatDate(end, dateFormat)}`,
          start: cursor,
          end
        });
        cursor = addDaysISO(end, 1);
      }
    } else {
      const startParts = parseISODateParts(from);
      const endParts = parseISODateParts(to);
      let cursorYear = startParts.year;
      let cursorMonth = startParts.month;
      const months = [];
      while (cursorYear < endParts.year || (cursorYear === endParts.year && cursorMonth <= endParts.month)) {
        months.push({ year: cursorYear, month: cursorMonth });
        cursorMonth += 1;
        if (cursorMonth > 12) {
          cursorMonth = 1;
          cursorYear += 1;
        }
      }
      const truncated = months.length > 36;
      const visibleMonths = truncated ? months.slice(-36) : months;
      for (const item of visibleMonths) {
        const start = `${item.year}-${pad2(item.month)}-01`;
        const end = endOfMonthISO(start);
        buckets.push({
          key: `${item.year}-${pad2(item.month)}`,
          label: formatMonthLabel(item.year, item.month),
          title: `${MONTHS_LONG[item.month - 1]} ${item.year}`,
          start,
          end
        });
      }
      for (const bucket of buckets) {
        const bucketRows = filtered.filter((row) => row.date >= bucket.start && row.date <= bucket.end);
        Object.assign(bucket, summarize(bucketRows));
      }
      return { buckets, granularity, truncated: truncated || false, from, to };
    }

    for (const bucket of buckets) {
      const bucketRows = filtered.filter((row) => row.date >= bucket.start && row.date <= bucket.end);
      Object.assign(bucket, summarize(bucketRows));
    }
    return { buckets, granularity, truncated: false, from, to };
  }

  /* ----------------------------------------------------------------- import */

  const IMPORT_ALIASES = {
    date: ['date', 'transaction date', 'entry date', 'txn date', 'posting date', 'value date', 'book date', 'dt'],
    particulars: ['particulars', 'description', 'narration', 'details', 'transaction details', 'particular', 'memo', 'remarks', 'payee', 'name', 'transaction'],
    debit: ['debit', 'dr', 'withdrawal', 'withdrawal amt', 'expense amount', 'debit amount', 'paid out', 'payment', 'money out'],
    credit: ['credit', 'cr', 'deposit', 'deposit amt', 'income amount', 'credit amount', 'paid in', 'receipt', 'money in'],
    category: ['category', 'categories', 'category name', 'expense category', 'income category', 'head', 'classification', 'group']
  };

  function normalizeHeader(value) {
    return String(value === null || value === undefined ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function headerScore(row) {
    const cells = (row || []).map(normalizeHeader);
    let score = 0;
    for (const aliases of Object.values(IMPORT_ALIASES)) {
      if (cells.some((cell) => aliases.includes(cell))) score += 1;
    }
    return score;
  }

  function detectHeaderRow(rows) {
    let best = -1;
    let bestScore = 1;
    const limit = Math.min((rows || []).length, 30);
    for (let index = 0; index < limit; index += 1) {
      const score = headerScore(rows[index]);
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    return best;
  }

  function suggestMapping(headers) {
    const normalized = (headers || []).map(normalizeHeader);
    const used = new Set();
    const result = { date: null, particulars: null, debit: null, credit: null, category: null };
    const find = (field) => {
      const aliases = IMPORT_ALIASES[field];
      let index = normalized.findIndex((header, i) => !used.has(i) && aliases.includes(header));
      if (index < 0) {
        index = normalized.findIndex((header, i) => !used.has(i) && aliases.some((alias) => header.includes(alias)));
      }
      if (index >= 0) used.add(index);
      return index >= 0 ? index : null;
    };
    // Particulars first so a "Transaction" column is not mistaken for a date.
    for (const field of ['date', 'particulars', 'debit', 'credit', 'category']) {
      result[field] = find(field);
    }
    return result;
  }

  function excelSerialToISO(serial) {
    if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
    if (serial < 1 || serial > 2958465) return null;
    // Excel's epoch, including its intentional 1900 leap-year bug.
    const utc = Math.round((serial - 25569) * 86400000);
    const date = new Date(utc);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (year < 1900 || year > 2100) return null;
    const value = `${year}-${pad2(month)}-${pad2(day)}`;
    return isValidISODate(value) ? value : null;
  }

  function monthNumberFromName(value) {
    const text = String(value || '').toLowerCase().replace(/\./g, '');
    if (text.length < 3) return null;
    const index = MONTHS_LONG.findIndex((month) => month.toLowerCase().startsWith(text));
    if (index >= 0) return index + 1;
    const shortIndex = MONTHS_SHORT.findIndex((month) => month.toLowerCase() === text);
    return shortIndex >= 0 ? shortIndex + 1 : null;
  }

  function expandYear(value) {
    let year = Number(value);
    if (!Number.isFinite(year)) return null;
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return year >= 1900 && year <= 2100 ? year : null;
  }

  function buildISODate(year, month, day) {
    const value = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
    return isValidISODate(value) ? value : null;
  }

  function isoFromDateObject(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    const localMidnight = value.getHours() === 0 && value.getMinutes() === 0
      && value.getSeconds() === 0 && value.getMilliseconds() === 0;
    const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
    if (localMidnight && !utcMidnight) {
      return buildISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (utcMidnight) {
      return buildISODate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    }
    return buildISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  function parseImportDate(value, mode) {
    const dateMode = mode === 'mdy' || mode === 'auto' ? mode : 'dmy';
    if (value === null || value === undefined || String(value).trim() === '') {
      return { ok: false, error: 'Missing date' };
    }
    if (value instanceof Date) {
      const iso = isoFromDateObject(value);
      return iso ? { ok: true, date: iso } : { ok: false, error: 'Date is outside the supported range' };
    }
    if (typeof value === 'number') {
      const iso = excelSerialToISO(value);
      return iso
        ? { ok: true, date: iso }
        : { ok: false, error: 'Unrecognized Excel date' };
    }

    let text = String(value).trim().replace(/^'/, '');
    if (!text) return { ok: false, error: 'Missing date' };
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) text = text.slice(0, 10);

    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
    if (match) {
      const iso = buildISODate(Number(match[1]), Number(match[2]), Number(match[3]));
      return iso ? { ok: true, date: iso } : { ok: false, error: 'Invalid date' };
    }

    match = /^(\d{1,2})(?:st|nd|rd|th)?[\s./-]+([A-Za-z]{3,9})[\s,./-]+(\d{2,4})$/.exec(text);
    if (match) {
      const month = monthNumberFromName(match[2]);
      const year = expandYear(match[3]);
      if (!month || !year) return { ok: false, error: 'Invalid date' };
      const iso = buildISODate(year, month, Number(match[1]));
      return iso ? { ok: true, date: iso } : { ok: false, error: 'Invalid date' };
    }

    match = /^([A-Za-z]{3,9})[\s./-]+(\d{1,2})(?:st|nd|rd|th)?[,\s./-]+(\d{2,4})$/.exec(text);
    if (match) {
      const month = monthNumberFromName(match[1]);
      const year = expandYear(match[3]);
      if (!month || !year) return { ok: false, error: 'Invalid date' };
      const iso = buildISODate(year, month, Number(match[2]));
      return iso ? { ok: true, date: iso } : { ok: false, error: 'Invalid date' };
    }

    match = /^(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+(\d{2,4})$/.exec(text);
    if (match) {
      let first = Number(match[1]);
      let second = Number(match[2]);
      const year = expandYear(match[3]);
      if (!year) return { ok: false, error: 'Invalid date' };
      let day;
      let month;
      if (first > 12 && second > 12) return { ok: false, error: 'Invalid date' };
      if (first > 12) {
        day = first;
        month = second;
      } else if (second > 12) {
        month = first;
        day = second;
      } else if (first === second) {
        day = first;
        month = second;
      } else if (dateMode === 'auto') {
        return { ok: false, error: 'Ambiguous date · choose Day first or Month first', ambiguous: true };
      } else if (dateMode === 'mdy') {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }
      const iso = buildISODate(year, month, day);
      return iso ? { ok: true, date: iso } : { ok: false, error: 'Invalid date' };
    }

    return { ok: false, error: 'Unrecognized date' };
  }

  function parseImportAmount(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return { ok: true, value: ZERO, minor: 0n, blank: true };
    }
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^\(.*\)$/.test(text) || /^[-−]/.test(text)) {
        return { ok: false, error: 'Negative amount' };
      }
      if (!text) return { ok: true, value: ZERO, minor: 0n, blank: true };
    }
    return parseMoney(value);
  }

  function duplicateKeyCounts(source) {
    const counts = new Map();
    if (!source) return counts;
    if (source instanceof Map) {
      for (const [key, value] of source.entries()) {
        const count = Number(value);
        if (count > 0) counts.set(key, count);
      }
      return counts;
    }
    const iterable = source instanceof Set ? [...source] : Array.isArray(source) ? source : [];
    for (const key of iterable) counts.set(String(key), (counts.get(String(key)) || 0) + 1);
    return counts;
  }

  function importRowText(source) {
    return (source || [])
      .map((cell) => normalizeText(cell))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function parseImportBalance(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    let number = value;
    let side = 'credit';
    if (typeof value === 'string') {
      let text = value.trim();
      if (/^\(.*\)$/.test(text) || /^-/.test(text)) side = 'debit';
      if (/(?:\bdr|\bdebit)\.?$/i.test(text)) {
        side = 'debit';
        text = text.replace(/(?:\bdr|\bdebit)\.?$/i, '');
      } else if (/(?:\bcr|\bcredit)\.?$/i.test(text)) {
        side = 'credit';
        text = text.replace(/(?:\bcr|\bcredit)\.?$/i, '');
      }
      text = text.replace(/^\(/, '').replace(/\)$/, '').replace(/^-/, '').trim();
      number = text;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      if (value < 0) side = 'debit';
      number = Math.abs(value);
    } else {
      return null;
    }
    const parsed = parseMoney(number);
    if (!parsed.ok) return null;
    return { value: parsed.value, minor: parsed.minor, side };
  }

  function importSummaryRowInfo(source, map) {
    const text = importRowText(source);
    if (!text) return null;
    const dateText = map && map.date !== null && map.date !== undefined
      ? normalizeText(source[map.date]).toLowerCase()
      : '';
    const hasTotal = /\b(?:grand\s+)?total(?:s)?\b/.test(text);
    const hasBalanceLabel = /(?:current|closing|available|account)\s+bal(?:ance)?\.?\b|balance\s*(?:c\/f|b\/f|carried|forward)/.test(text);
    if (!hasTotal && !hasBalanceLabel) return null;
    const dateValid = map && map.date !== null && map.date !== undefined
      ? parseImportDate(source[map.date], 'dmy').ok
      : false;
    const numericCells = (source || []).map((cell, index) => ({
      index,
      amount: parseImportAmount(cell)
    })).filter((cell) => cell.amount.ok && cell.amount.minor > 0n);
    if (!numericCells.length) return null;
    // A real line such as "Total fuel" with a valid date is a transaction.
    if (dateValid && !/^total(?:s)?\b/.test(dateText)) return null;
    const debitResult = map && map.debit !== null && map.debit !== undefined
      ? parseImportAmount(source[map.debit])
      : null;
    const creditResult = map && map.credit !== null && map.credit !== undefined
      ? parseImportAmount(source[map.credit])
      : null;
    const excluded = new Set([map && map.debit, map && map.credit].filter((value) => value !== null && value !== undefined));
    let balance = null;
    for (let index = 0; index < (source || []).length; index += 1) {
      if (excluded.has(index)) continue;
      const cellText = normalizeText(source[index]);
      if (!cellText) continue;
      if (!/(?:current|closing|available|account)\s+bal(?:ance)?\.?\b|balance\s*(?:c\/f|b\/f)/i.test(cellText)) continue;
      const candidates = [index - 1, index + 1, index - 2, index + 2];
      for (const candidate of candidates) {
        if (candidate < 0 || candidate >= source.length || excluded.has(candidate)) continue;
        const parsed = parseImportBalance(source[candidate]);
        if (parsed) {
          balance = parsed;
          break;
        }
      }
      if (balance) break;
    }
    if (!balance) {
      const extras = numericCells.filter((cell) => !excluded.has(cell.index));
      if (extras.length) {
        const last = extras[extras.length - 1];
        balance = {
          value: last.amount.value,
          minor: last.amount.minor,
          side: 'credit'
        };
      }
    }
    return {
      debit: debitResult && debitResult.ok ? debitResult.value : null,
      credit: creditResult && creditResult.ok ? creditResult.value : null,
      balance
    };
  }

  function findImportSheetBalance(rows, headerRow, map) {
    let found = null;
    for (let rowIndex = (headerRow || 0) + 1; rowIndex < (rows || []).length; rowIndex += 1) {
      const source = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
      for (let index = 0; index < source.length; index += 1) {
        const text = normalizeText(source[index]);
        if (!text || !/(?:current|closing|available|account)\s+bal(?:ance)?\.?\b|balance\s*(?:c\/f|b\/f)/i.test(text)) continue;
        const candidates = [index - 1, index + 1, index - 2, index + 2];
        for (const candidate of candidates) {
          if (candidate < 0 || candidate >= source.length) continue;
          const parsed = parseImportBalance(source[candidate]);
          if (parsed) {
            found = {
              rowNumber: rowIndex + 1,
              label: text,
              column: candidate,
              value: parsed.value,
              minor: parsed.minor,
              side: parsed.side
            };
            break;
          }
        }
        if (found) break;
      }
    }
    return found;
  }

  function analyzeImportRows(input) {
    const data = input || {};
    const allRows = Array.isArray(data.rows) ? data.rows : [];
    const headerRow = Number.isInteger(data.headerRow) ? data.headerRow : 0;
    const mapping = data.mapping || {};
    const dateMode = data.dateMode || 'dmy';
    const duplicateMode = data.duplicateMode === 'all' ? 'all' : 'skip';
    const existing = duplicateKeyCounts(data.existingKeys);
    const rows = [];
    const summaryRows = [];
    const indexOf = (field) => {
      const value = mapping[field];
      if (value === null || value === undefined || value === '' || value === -1) return null;
      const index = Number(value);
      return Number.isInteger(index) && index >= 0 ? index : null;
    };
    const map = {
      date: indexOf('date'),
      particulars: indexOf('particulars'),
      debit: indexOf('debit'),
      credit: indexOf('credit'),
      category: indexOf('category')
    };

    for (let rowIndex = headerRow + 1; rowIndex < allRows.length; rowIndex += 1) {
      const source = Array.isArray(allRows[rowIndex]) ? allRows[rowIndex] : [];
      const rowNumber = rowIndex + 1;
      if (source.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')) continue;

      const summaryRow = importSummaryRowInfo(source, map);
      if (summaryRow) {
        summaryRows.push({ rowNumber, ...summaryRow });
        continue;
      }

      const errors = [];
      const dateResult = map.date === null
        ? { ok: false, error: 'Map the date column' }
        : parseImportDate(source[map.date], dateMode);
      const particulars = map.particulars === null
        ? ''
        : normalizeText(source[map.particulars]);
      if (map.particulars === null) errors.push('Map the particulars column');
      else if (!particulars) errors.push('Missing particulars');
      else if (particulars.length > 240) errors.push('Particulars are too long');

      const sourceCategory = map.category === null ? '' : normalizeText(source[map.category]);
      const category = resolveCategory(sourceCategory, particulars, data.categories);

      const debitResult = map.debit === null ? { ok: true, value: ZERO, minor: 0n } : parseImportAmount(source[map.debit]);
      const creditResult = map.credit === null ? { ok: true, value: ZERO, minor: 0n } : parseImportAmount(source[map.credit]);
      if (map.debit === null && map.credit === null) errors.push('Map a debit or credit column');
      if (!dateResult.ok) errors.push(dateResult.error);
      if (!debitResult.ok) errors.push(`Debit: ${debitResult.error}`);
      if (!creditResult.ok) errors.push(`Credit: ${creditResult.error}`);

      const debit = debitResult.ok ? debitResult.minor : 0n;
      const credit = creditResult.ok ? creditResult.minor : 0n;
      if (debitResult.ok && creditResult.ok && debit === 0n && credit === 0n) {
        errors.push('Enter a debit or credit amount');
      }

      let duplicate = false;
      let key = '';
      if (!errors.length) {
        key = [
          dateResult.date,
          particulars.toLowerCase(),
          canonicalFromMinor(debit),
          canonicalFromMinor(credit)
        ].join('|');
        // Only rows that already exist in the journal count as duplicates.
        // Two identical lines inside one statement are both real transactions,
        // so the file itself is never treated as a duplicate source. Counts
        // preserve multiplicity when a statement is re-imported.
        const remaining = existing.get(key) || 0;
        duplicate = remaining > 0;
        if (remaining > 0) existing.set(key, remaining - 1);
      }
      const accepted = errors.length === 0 && (duplicateMode === 'all' || !duplicate);
      rows.push({
        rowNumber,
        date: dateResult.ok ? dateResult.date : '',
        particulars,
        category,
        debit: debitResult.ok ? canonicalFromMinor(debit) : ZERO,
        credit: creditResult.ok ? canonicalFromMinor(credit) : ZERO,
        errors,
        duplicate,
        accepted,
        key
      });
    }

    const validRows = rows.filter((row) => !row.errors.length);
    const duplicateRows = validRows.filter((row) => row.duplicate);
    const acceptedRows = rows.filter((row) => row.accepted);
    const debitTotal = sumField(acceptedRows, 'debit');
    const creditTotal = sumField(acceptedRows, 'credit');
    const movementMinor = moneyMinor(creditTotal) - moneyMinor(debitTotal);
    const detectedBalance = findImportSheetBalance(allRows, headerRow, map);
    const summaryBalance = summaryRows
      .map((row) => row.balance)
      .filter(Boolean)
      .pop() || null;
    const sheetBalance = detectedBalance || (summaryBalance ? {
      rowNumber: null,
      label: 'Current balance',
      column: null,
      ...summaryBalance
    } : null);
    const sheetBalanceMinor = sheetBalance
      ? (sheetBalance.side === 'debit' ? -sheetBalance.minor : sheetBalance.minor)
      : null;
    const openingMinor = sheetBalanceMinor === null ? null : sheetBalanceMinor - movementMinor;
    const sheetSummary = summaryRows.find((row) => row.debit || row.credit) || null;
    return {
      rows,
      validRows,
      invalidRows: rows.filter((row) => row.errors.length),
      duplicateRows,
      acceptedRows,
      summaryRows,
      reconciliation: {
        scannedRows: Math.max(0, allRows.length - headerRow - 1),
        summaryRows: summaryRows.length,
        sheetDebit: sheetSummary ? sheetSummary.debit : null,
        sheetCredit: sheetSummary ? sheetSummary.credit : null,
        sheetBalance: sheetBalance ? sheetBalance.value : null,
        sheetBalanceSide: sheetBalance ? sheetBalance.side : null,
        sheetBalanceRow: sheetBalance ? sheetBalance.rowNumber : null,
        movementDebit: debitTotal,
        movementCredit: creditTotal,
        movementNet: canonicalFromMinor(movementMinor),
        openingBalance: openingMinor === null ? null : canonicalFromMinor(openingMinor < 0n ? -openingMinor : openingMinor),
        openingBalanceSide: openingMinor === null ? null : openingMinor < 0n ? 'debit' : 'credit',
        balanceDifference: sheetBalanceMinor === null ? null : canonicalFromMinor(sheetBalanceMinor - movementMinor)
      },
      summary: {
        total: rows.length,
        valid: validRows.length,
        invalid: rows.length - validRows.length,
        duplicates: duplicateRows.length,
        accepted: acceptedRows.length,
        debit: debitTotal,
        credit: creditTotal
      }
    };
  }

  /* ------------------------------------------------------------------ export */

  function csvEscape(value) {
    const text = String(value === null || value === undefined ? '' : value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function matrixToCSV(matrix) {
    return (matrix || []).map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  function journalMatrix(transactions, options) {
    const opts = options || {};
    const rows = sortedById(transactions).sort((a, b) => {
      const dateCompare = compareISO(a.date, b.date);
      return dateCompare || String(a.id).localeCompare(String(b.id));
    });
    const header = ['Date', 'Particulars', 'Debit', 'Credit'];
    const body = rows.map((row) => [
      opts.isoDate === false ? formatDate(row.date, opts.dateFormat) : row.date,
      row.particulars,
      isZeroMoney(row.debit) ? '' : parseMoney(row.debit).value,
      isZeroMoney(row.credit) ? '' : parseMoney(row.credit).value
    ]);
    return [header, ...body];
  }

  function journalCSV(transactions, options) {
    return matrixToCSV(journalMatrix(transactions, options));
  }

  /* ------------------------------------------------------------------ backup */

  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const FNV_MASK = 0xffffffffffffffffn;

  function fnv1a64(text) {
    let hash = FNV_OFFSET;
    const value = String(text);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = (hash * FNV_PRIME) & FNV_MASK;
    }
    return hash.toString(16).padStart(16, '0');
  }

  // Version 3 backups carry every user preference, including the category
  // register. Version 2 files hashed only the core display settings, so their
  // checksum still has to be checked against the old shape.
  function settingsForBackup(settings, formatVersion) {
    if (Number(formatVersion) < 3) {
      return {
        currency: settings.currency,
        dateFormat: settings.dateFormat,
        theme: settings.theme,
        defaultSort: settings.defaultSort,
        pageSize: settings.pageSize,
        openingBalance: settings.openingBalance,
        openingBalanceSide: settings.openingBalanceSide
      };
    }
    return {
      currency: settings.currency,
      dateFormat: settings.dateFormat,
      theme: settings.theme,
      defaultSort: settings.defaultSort,
      pageSize: settings.pageSize,
      openingBalance: settings.openingBalance,
      openingBalanceSide: settings.openingBalanceSide,
      goalName: settings.goalName,
      goalTarget: settings.goalTarget,
      monthlyBudget: settings.monthlyBudget,
      accountName: settings.accountName,
      accountType: settings.accountType,
      categories: normalizeCategoryList(settings.categories)
    };
  }

  function integrityFor(transactions, settings, imports, formatVersion) {
    const tx = sortedById(transactions).map((row) => ({
      id: row.id,
      date: row.date,
      particulars: row.particulars,
      category: row.category || 'Uncategorised',
      debit: row.debit,
      credit: row.credit
    }));
    const history = [...(imports || [])]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((item) => ({
        id: item.id,
        fileName: item.fileName,
        at: item.at,
        imported: item.imported,
        skipped: item.skipped
      }));
    const summary = summarize(transactions);
    const settingsForHash = settingsForBackup(settings, formatVersion === undefined ? BACKUP_FORMAT_VERSION : formatVersion);
    const checksum = fnv1a64(JSON.stringify({ tx, settings: settingsForHash, history }));
    return {
      algorithm: 'fnv1a64',
      checksum,
      count: summary.count,
      debit: summary.debit,
      credit: summary.credit
    };
  }

  function createBackup(input) {
    const data = input || {};
    const normalizedSettings = normalizeSettings(data.settings).settings;
    const transactions = sortedById(data.transactions || []);
    const imports = [...(data.imports || [])];
    return {
      app: APP_ID,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: data.exportedAt || new Date().toISOString(),
      settings: settingsForBackup(normalizedSettings, BACKUP_FORMAT_VERSION),
      transactions,
      imports,
      integrity: integrityFor(transactions, normalizedSettings, imports, BACKUP_FORMAT_VERSION)
    };
  }

  function convertLegacyBackup(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.app === APP_ID) return null;
    const legacyTransactions = Array.isArray(raw.transactions) ? raw.transactions : Array.isArray(raw.txs) ? raw.txs : null;
    if (!legacyTransactions) return null;
    if (!legacyTransactions.every((tx) => tx && (tx.type === 'expense' || tx.type === 'income') && tx.date)) return null;
    const converted = legacyTransactions
      .map((tx, index) => transactionFromLegacy(tx, index))
      .filter(Boolean);
    const settings = normalizeSettings(raw.settings).settings;
    return {
      transactions: converted,
      settings,
      imports: [],
      warnings: ['This was an older Moneta backup. Income and expenses were converted to credits and debits.']
    };
  }

  function validateBackup(raw) {
    let data = raw;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (error) {
        return { ok: false, errors: ['This file is not valid JSON.'] };
      }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, errors: ['This file does not contain a backup object.'] };
    }

    const legacy = convertLegacyBackup(data);
    if (legacy) {
      if (!legacy.transactions.length) {
        return { ok: false, errors: ['The old backup does not contain any usable transactions.'] };
      }
      return {
        ok: true,
        data: {
          transactions: sortedById(legacy.transactions),
          settings: legacy.settings,
          imports: [],
          exportedAt: data.exportedAt || null,
          formatVersion: 1,
          legacy: true
        },
        warnings: legacy.warnings
      };
    }

    const errors = [];
    if (data.app !== APP_ID) errors.push('This is not a Moneta backup.');
    const formatVersion = Number(data.formatVersion);
    if (!Number.isInteger(formatVersion) || formatVersion < 1 || formatVersion > BACKUP_FORMAT_VERSION) {
      errors.push('This backup format is not supported by this version of Moneta.');
    }
    if (!Array.isArray(data.transactions)) errors.push('The backup is missing its transaction list.');
    if (errors.length) return { ok: false, errors };

    const settingsResult = normalizeSettings(data.settings, { strict: true });
    if (!settingsResult.ok) {
      errors.push(...settingsResult.errors.map((error) => `Settings: ${error}`));
    }
    const transactions = [];
    const ids = new Set();
    for (let index = 0; index < data.transactions.length; index += 1) {
      const result = normalizeTransaction(data.transactions[index], {
        requireId: true,
        source: 'backup',
        categories: settingsResult.settings.categories
      });
      if (!result.ok) {
        const reasons = Object.values(result.errors).join('; ');
        errors.push(`Transaction ${index + 1}: ${reasons}.`);
        if (errors.length > 20) break;
      } else if (ids.has(result.value.id)) {
        errors.push(`Transaction ${index + 1}: duplicate id.`);
      } else {
        ids.add(result.value.id);
        transactions.push(result.value);
      }
    }

    const imports = [];
    const importIds = new Set();
    if (data.imports !== undefined) {
      if (!Array.isArray(data.imports)) {
        errors.push('The backup import history is invalid.');
      } else {
        for (const item of data.imports) {
          if (!item || typeof item !== 'object') {
            errors.push('The backup contains an invalid import history row.');
            continue;
          }
          const id = normalizeText(item.id);
          if (!id || importIds.has(id)) {
            errors.push('The backup contains an invalid import history id.');
            continue;
          }
          importIds.add(id);
          imports.push({
            id,
            fileName: normalizeText(item.fileName || 'Spreadsheet').slice(0, 200),
            at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
            imported: Number.isFinite(Number(item.imported)) ? Math.max(0, Number(item.imported)) : 0,
            skipped: Number.isFinite(Number(item.skipped)) ? Math.max(0, Number(item.skipped)) : 0
          });
        }
      }
    }

    const summary = summarize(transactions);
    if (data.integrity && data.integrity.algorithm === 'fnv1a64') {
      if (Number(data.integrity.count) !== summary.count
        || String(data.integrity.debit) !== summary.debit
        || String(data.integrity.credit) !== summary.credit) {
        errors.push('The backup totals do not match its transactions.');
      } else {
        const expected = integrityFor(transactions, settingsResult.settings, imports, formatVersion);
        if (data.integrity.checksum !== expected.checksum) {
          errors.push('The backup integrity check failed. The file may be damaged.');
        }
      }
    } else if (formatVersion >= 2) {
      errors.push('The backup is missing its integrity check.');
    }

    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      data: {
        transactions: sortedById(transactions),
        settings: settingsResult.settings,
        imports,
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
        formatVersion,
        summary
      },
      warnings: []
    };
  }

  function backupSummary(data) {
    const summary = summarize(data.transactions || []);
    return {
      ...summary,
      imports: (data.imports || []).length,
      from: (data.transactions || []).reduce((min, row) => (!min || row.date < min ? row.date : min), ''),
      to: (data.transactions || []).reduce((max, row) => (!max || row.date > max ? row.date : max), '')
    };
  }

  function buildReportCsv(transactions, range, dateFormat) {
    const rows = filterTransactions(transactions, { from: range && range.from, to: range && range.to, dateFormat });
    const summary = summarize(rows);
    const debitTop = topParticulars(rows, 'debit', 10);
    const creditTop = topParticulars(rows, 'credit', 10);
    const matrix = [
      ['Moneta period report'],
      ['From', range && range.from ? range.from : 'All time'],
      ['To', range && range.to ? range.to : 'All time'],
      [],
      ['Entries', 'Total debits', 'Total credits', 'Net movement'],
      [summary.count, summary.debit, summary.credit, summary.net],
      [],
      ['Top debits', 'Count', 'Amount'],
      ...debitTop.map((item) => [item.particulars, item.count, item.amount]),
      [],
      ['Top credits', 'Count', 'Amount'],
      ...creditTop.map((item) => [item.particulars, item.count, item.amount])
    ];
    return matrixToCSV(matrix);
  }

  return {
    APP_ID,
    SCHEMA_VERSION,
    BACKUP_FORMAT_VERSION,
    ZERO,
    MAX_MINOR,
    CURRENCIES,
    DATE_FORMATS,
    SORT_OPTIONS,
    PERIOD_OPTIONS,
    PAGE_SIZES,
    CATEGORIES,
    CATEGORY_RULES,
    DEFAULT_SETTINGS,
    MONTHS_SHORT,
    MONTHS_LONG,
    WEEKDAYS_SHORT,
    pad2,
    clamp,
    toISODate,
    todayISO,
    parseISODateParts,
    isValidISODate,
    formatDate,
    formatLongDate,
    formatMonthLabel,
    formatRangeLabel,
    addDaysISO,
    startOfMonthISO,
    endOfMonthISO,
    monthKey,
    compareISO,
    daysBetween,
    weekdayIndex,
    financialYearRange,
    computePeriodRange,
    dateSearchVariants,
    parseMoney,
    moneyMinor,
    canonicalFromMinor,
    addMoney,
    subtractMoney,
    negateMoney,
    compareMoney,
    isZeroMoney,
    sumField,
    summarize,
    netMovement,
    openingBalanceMinor,
    accountMovement,
    accountBalance,
    formatAmount,
    formatMoney,
    formatCompactMoney,
    currencyInfo,
    currencySymbol,
    percent,
    normalizeSettings,
    DEFAULT_CATEGORIES,
    CATEGORY_LIMITS,
    normalizeCategoryList,
    categoryNames,
    resolveCategory,
    inferCategoryId,
    inferCategory,
    newId,
    normalizeText,
    normalizeTransaction,
    transactionFromLegacy,
    duplicateKey,
    transactionKeySet,
    transactionKeyCounts,
    sortTransactions,
    sortConfig,
    nextSortConfig,
    filterTransactions,
    paginate,
    topParticulars,
    categoryBreakdown,
    largestEntries,
    weekdayBreakdown,
    buildTrend,
    IMPORT_ALIASES,
    normalizeHeader,
    headerScore,
    detectHeaderRow,
    suggestMapping,
    excelSerialToISO,
    isoFromDateObject,
    parseImportDate,
    parseImportAmount,
    parseImportBalance,
    importSummaryRowInfo,
    findImportSheetBalance,
    analyzeImportRows,
    csvEscape,
    matrixToCSV,
    journalMatrix,
    journalCSV,
    fnv1a64,
    createBackup,
    validateBackup,
    backupSummary,
    buildReportCsv
  };
});
