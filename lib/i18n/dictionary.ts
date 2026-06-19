/**
 * DEFAULT DICTIONARY (RFC §2.13) — English baseline.
 *
 * Keys are flat: `<type>:<category>[.<code>]:<locale>`. Generic `*:...` keys
 * cover engine-level codes (required/choice/match/items) and any type that has
 * no specific entry; the resolver's fallback chain (RFC §3.6) reaches them.
 * Authors merge their own dictionary over this one.
 */

import type { Dictionary } from '../core/contracts';

export const defaultDictionary: Dictionary = {
  // --- generic error messages (engine + type codes) ---
  '*:error.required:en': 'This field is required.',
  '*:error.invalid:en': 'Please enter a valid value.',
  '*:error.min:en': 'Value is below the allowed minimum.',
  '*:error.max:en': 'Value is above the allowed maximum.',
  '*:error.step:en': 'Value is not an allowed increment.',
  '*:error.scale:en': 'Too many decimal places.',
  '*:error.range:en': 'Value is out of range.',
  '*:error.choice:en': 'Choose one of the allowed options.',
  '*:error.match:en': 'Value does not match the required format.',
  '*:error.minItems:en': 'Please add more items.',
  '*:error.maxItems:en': 'Too many items.',
  '*:error.unique:en': 'Items must be unique.',
  '*:error.depInvalid:en': 'This value does not satisfy a related field.',

  // --- generic warnings (validation category) ---
  '*:validation.unknown:en': 'Unrecognized value.',
  'currency:validation.unknown:en': 'Unknown currency code "{code}".',

  // --- type-specific error overrides ---
  'email:error.invalid:en': 'Please enter a valid email address.',
  'uuid:error.invalid:en': 'Please enter a valid UUID.',
  'url:error.invalid:en': 'Please enter a valid URL.',
  'ipv4:error.invalid:en': 'Please enter a valid IPv4 address.',
  'ipv6:error.invalid:en': 'Please enter a valid IPv6 address.',
  'datetime:error.invalid:en': 'Please enter a valid date and time.',
  'date:error.invalid:en': 'Please enter a valid date.',
  'time:error.invalid:en': 'Please enter a valid time.',

  // --- type labels (fallback when a field has no name-derived label) ---
  'string:label:en': 'Text',
  'bool:label:en': 'Yes / No',
  'int32:label:en': 'Number',
  'int64:label:en': 'Number',
  'float32:label:en': 'Number',
  'float64:label:en': 'Number',
  'decimal:label:en': 'Amount',
  'email:label:en': 'Email',
  'uuid:label:en': 'Identifier',
  'url:label:en': 'URL',
  'ipv4:label:en': 'IP Address',
  'ipv6:label:en': 'IPv6 Address',
  'datetime:label:en': 'Date & Time',
  'date:label:en': 'Date',
  'time:label:en': 'Time',
  'duration:label:en': 'Duration',
  'currency:label:en': 'Currency',
  'language:label:en': 'Language',
  'timezone:label:en': 'Time Zone',
  'json:label:en': 'Data',
  'money:label:en': 'Amount',
  'country:label:en': 'Country',
  'phone:label:en': 'Phone',
  'array:label:en': 'List',
  'object:label:en': 'Object',
  'any:label:en': 'Value',

  // type-specific messages for the new types
  'money:error.invalid:en': 'Please enter a valid amount.',
  'phone:error.invalid:en': 'Please enter a valid phone number (E.164, e.g. +14155552671).',
  'country:error.invalid:en': 'Please enter a 2-letter country code.',
  'country:validation.unknown:en': 'Unrecognized country code "{code}".',
};
