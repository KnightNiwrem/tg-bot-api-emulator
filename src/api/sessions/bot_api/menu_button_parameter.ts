import { z } from 'zod';

import type { BotMenuButton } from '../../../types/bot_menu_button.ts';
import { parseBotApiJsonParameter } from './request_parameters.ts';

export type MenuButtonParameterReading =
  | { readonly read: true; readonly menuButton: BotMenuButton }
  | { readonly read: false; readonly description: string };

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
    return { read: false, description: "Bad Request: can't parse menu button JSON object" };
  }
  const { value } = parsedParameter;
  const menuButtonError = (error: string): MenuButtonParameterReading => ({
    read: false,
    description: `Bad Request: can't parse menu button: ${error}`,
  });
  const malformedMenuButton: MenuButtonParameterReading = {
    read: false,
    description: invalidParametersDescription,
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return menuButtonError('MenuButton must be an Object');
  }
  if (!('type' in value)) {
    return menuButtonError('Can\'t find field "type"');
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
        return menuButtonError('Can\'t find field "text"');
      }
      if (!('web_app' in value)) {
        return menuButtonError('Can\'t find field "web_app"');
      }
      const webApp = value.web_app;
      if (typeof webApp !== 'object' || webApp === null || Array.isArray(webApp)) {
        return menuButtonError('Field "web_app" must be of type Object');
      }
      if (!('url' in webApp)) {
        return menuButtonError('Can\'t find field "url"');
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
      return menuButtonError('MenuButton has unsupported type');
  }
}
