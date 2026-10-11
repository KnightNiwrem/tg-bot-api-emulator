import { z } from 'zod';

import type { BotMenuButton } from '../../../types/bot_menu_button.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { type JsonObjectFieldError, parseBotApiJsonParameter } from './request_parameters.ts';

export type MenuButtonParameterReading =
  | { readonly read: true; readonly menuButton: BotMenuButton }
  | { readonly read: false; readonly description: string };

/**
 * Why the official Bot API server's `get_bot_menu_button` cannot read a menu button: it is not an
 * object, it has a type the server does not know, or a field is missing or not an object.
 */
export type MenuButtonError =
  | { readonly reason: 'menu_button_not_object' | 'menu_button_type_unsupported' }
  | JsonObjectFieldError;

const menuButtonTypeSchema = z.looseObject({ type: z.string() });
const buttonWithoutOptionsSchema = z.strictObject({ type: z.enum(['commands', 'default']) });
const webAppButtonSchema = z.strictObject({
  type: z.literal('web_app'),
  text: z.string(),
  web_app: z.strictObject({ url: z.string() }),
});

/**
 * Reads a `menu_button` parameter, a JSON `MenuButton` object, as the official Bot API server's
 * `get_bot_menu_button` does: missing or empty text is the default button, and Telegram's
 * descriptions answer text that is not a JSON object, a missing field, and an unsupported type.
 *
 * `invalidParametersDescription` answers buttons Telegram would read leniently, such as unknown
 * fields or a number where text is expected; rejecting them instead surfaces the bot's mistake in
 * tests.
 */
export function readMenuButtonParameter(
  text: string | undefined,
  invalidParametersDescription: string,
): MenuButtonParameterReading {
  if (text === undefined || text.length === 0) {
    return { read: true, menuButton: { kind: 'default' } };
  }
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return { read: false, description: BOT_API_ERRORS.menuButtonJsonInvalid.description() };
  }
  const { value } = parsedParameter;
  const menuButtonError = (error: MenuButtonError): MenuButtonParameterReading => ({
    read: false,
    description: BOT_API_ERRORS.menuButtonInvalid.description(error),
  });
  const fieldMissing = (fieldName: string): MenuButtonParameterReading =>
    menuButtonError({ reason: 'field_missing', fieldName });
  const malformedMenuButton: MenuButtonParameterReading = {
    read: false,
    description: invalidParametersDescription,
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return menuButtonError({ reason: 'menu_button_not_object' });
  }
  if (!('type' in value)) {
    return fieldMissing('type');
  }
  const menuButtonType = menuButtonTypeSchema.safeParse(value);
  if (!menuButtonType.success) {
    return malformedMenuButton;
  }

  switch (menuButtonType.data.type) {
    case 'commands':
    case 'default': {
      const menuButton = buttonWithoutOptionsSchema.safeParse(value);
      return menuButton.success
        ? { read: true, menuButton: { kind: menuButton.data.type } }
        : malformedMenuButton;
    }
    case 'web_app': {
      if (!('text' in value)) {
        return fieldMissing('text');
      }
      if (!('web_app' in value)) {
        return fieldMissing('web_app');
      }
      const webApp = value.web_app;
      if (typeof webApp !== 'object' || webApp === null || Array.isArray(webApp)) {
        return menuButtonError({
          reason: 'field_type_invalid',
          fieldName: 'web_app',
          expectedType: 'Object',
        });
      }
      if (!('url' in webApp)) {
        return fieldMissing('url');
      }
      const menuButton = webAppButtonSchema.safeParse(value);
      return menuButton.success
        ? {
          read: true,
          menuButton: {
            kind: 'web_app',
            text: menuButton.data.text,
            url: menuButton.data.web_app.url,
          },
        }
        : malformedMenuButton;
    }
    default:
      return menuButtonError({ reason: 'menu_button_type_unsupported' });
  }
}
