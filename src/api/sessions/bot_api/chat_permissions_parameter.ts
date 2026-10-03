import type { ChatPermission, ChatPermissions } from '../../../types/chat_permissions.ts';

export type ChatPermissionsParameterReading =
  | { readonly read: true; readonly permissions: ChatPermissions }
  | { readonly read: false; readonly description: string };

/** The permissions the official Bot API server reads first, in its order. */
const LEADING_PERMISSIONS = [
  'can_send_messages',
  'can_send_polls',
  'can_send_other_messages',
  'can_add_web_page_previews',
  'can_change_info',
  'can_invite_users',
  'can_pin_messages',
] as const satisfies readonly ChatPermission[];

/** The media permissions, which `can_send_media_messages` stands for when none is given. */
const MEDIA_PERMISSIONS = [
  'can_send_audios',
  'can_send_documents',
  'can_send_photos',
  'can_send_videos',
  'can_send_video_notes',
  'can_send_voice_notes',
] as const satisfies readonly ChatPermission[];

const MEDIA_MESSAGES_FIELD_NAME = 'can_send_media_messages';

/** The fields of a Bot API `ChatPermissions` object, with the derived `can_send_media_messages`. */
const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set([
  ...LEADING_PERMISSIONS,
  'can_manage_topics',
  ...MEDIA_PERMISSIONS,
  MEDIA_MESSAGES_FIELD_NAME,
  'can_edit_tag',
  'can_react_to_messages',
]);

/**
 * Reads a `permissions` parameter, a JSON `ChatPermissions` object, as the official Bot API
 * server's `get_chat_permissions` does for `restrictChatMember` and `setChatPermissions`: a missing
 * parameter grants nothing, as does a missing field, unless another field implies it:
 *
 * - `can_manage_topics` and `can_edit_tag` default to `can_pin_messages`.
 * - Without any media field, `can_send_media_messages` grants or withholds every media permission,
 *   and, unless `usesIndependentChatPermissions`, grants `can_send_messages` with them.
 * - `can_react_to_messages` defaults to `can_send_messages` as far as it is granted so far.
 * - Last, unless `usesIndependentChatPermissions`, `can_send_other_messages` or
 *   `can_add_web_page_previews` grants every media permission and `can_send_messages`, and
 *   `can_send_polls` grants `can_send_messages`.
 *
 * Telegram's descriptions answer text that is not a JSON object and a field that is not a JSON
 * boolean, checking fields in the server's order. `invalidParametersDescription` answers a field
 * Telegram does not know, which the server ignores; rejecting it instead surfaces the bot's
 * mistake in tests.
 */
export function readChatPermissionsParameter(
  text: string | undefined,
  { usesIndependentChatPermissions, invalidParametersDescription }: {
    readonly usesIndependentChatPermissions: boolean;
    readonly invalidParametersDescription: string;
  },
): ChatPermissionsParameterReading {
  if (text === undefined) {
    return { read: true, permissions: new Set() };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { read: false, description: "Bad Request: can't parse permissions JSON object" };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { read: false, description: 'Bad Request: object expected as permissions' };
  }
  const fields: ReadonlyMap<string, unknown> = new Map(Object.entries(value));
  const reading = readPermissionFields(fields, usesIndependentChatPermissions);
  if (!reading.read) {
    return {
      read: false,
      description: `Bad Request: can't parse chat permissions: Field "${reading.fieldName}" ` +
        'must be of type Boolean',
    };
  }
  if ([...fields.keys()].some((name) => !KNOWN_FIELD_NAMES.has(name))) {
    return { read: false, description: invalidParametersDescription };
  }
  return reading;
}

/**
 * Reads the fields of a `ChatPermissions` object in the order and with the implications that
 * `readChatPermissionsParameter` describes, stopping at the first field that is not a boolean.
 */
function readPermissionFields(
  fields: ReadonlyMap<string, unknown>,
  usesIndependentChatPermissions: boolean,
):
  | { readonly read: true; readonly permissions: ChatPermissions }
  | { readonly read: false; readonly fieldName: string } {
  const granted = new Set<ChatPermission>();
  /** A field's value, `valueWhenMissing` without one, or `undefined` for one of another type. */
  const readField = (name: string, valueWhenMissing: boolean): boolean | undefined => {
    const field = fields.get(name);
    if (field === undefined) {
      return valueWhenMissing;
    }
    return typeof field === 'boolean' ? field : undefined;
  };
  /** Grants a permission as its field asks, or reports a field of another type. */
  const readPermission = (permission: ChatPermission, valueWhenMissing: boolean) => {
    const isGranted = readField(permission, valueWhenMissing);
    if (isGranted) {
      granted.add(permission);
    }
    return isGranted !== undefined;
  };

  for (const permission of LEADING_PERMISSIONS) {
    if (!readPermission(permission, false)) {
      return { read: false, fieldName: permission };
    }
  }
  if (!readPermission('can_manage_topics', granted.has('can_pin_messages'))) {
    return { read: false, fieldName: 'can_manage_topics' };
  }
  if (MEDIA_PERMISSIONS.some((permission) => fields.has(permission))) {
    for (const permission of MEDIA_PERMISSIONS) {
      if (!readPermission(permission, false)) {
        return { read: false, fieldName: permission };
      }
    }
  } else {
    const sendsMedia = readField(MEDIA_MESSAGES_FIELD_NAME, false);
    if (sendsMedia === undefined) {
      return { read: false, fieldName: MEDIA_MESSAGES_FIELD_NAME };
    }
    if (sendsMedia) {
      MEDIA_PERMISSIONS.forEach((permission) => granted.add(permission));
      if (!usesIndependentChatPermissions) {
        granted.add('can_send_messages');
      }
    }
  }
  if (!readPermission('can_edit_tag', granted.has('can_pin_messages'))) {
    return { read: false, fieldName: 'can_edit_tag' };
  }
  if (!readPermission('can_react_to_messages', granted.has('can_send_messages'))) {
    return { read: false, fieldName: 'can_react_to_messages' };
  }

  if (!usesIndependentChatPermissions) {
    if (granted.has('can_send_other_messages') || granted.has('can_add_web_page_previews')) {
      MEDIA_PERMISSIONS.forEach((permission) => granted.add(permission));
      granted.add('can_send_messages');
    }
    if (granted.has('can_send_polls')) {
      granted.add('can_send_messages');
    }
  }
  return { read: true, permissions: granted };
}
