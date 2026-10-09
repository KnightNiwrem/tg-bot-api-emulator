import {
  type ReplyKeyboard,
  type ReplyKeyboardButton,
  type ReplyKeyboardButtonSelection,
  type ReplyKeyboardRequestAnswer,
  selectReplyKeyboardButton,
} from '../src/types/reply_interface.ts';

const plainButton: ReplyKeyboardButton = { text: 'Duplicate' };
const contactButton: ReplyKeyboardButton = { text: 'Duplicate', request: { kind: 'contact' } };
const locationButton: ReplyKeyboardButton = { text: 'Duplicate', request: { kind: 'location' } };
const webAppButton: ReplyKeyboardButton = {
  text: 'Duplicate',
  request: { kind: 'web_app', url: 'https://example.com/app' },
};
const quizButton: ReplyKeyboardButton = {
  text: 'Duplicate',
  request: { kind: 'poll', pollType: 'quiz' },
};

function usersButton(requestId: number, maxQuantity = 1): ReplyKeyboardButton {
  return {
    text: 'Duplicate',
    request: {
      kind: 'users',
      requestId,
      maxQuantity,
      requestsName: false,
      requestsUsername: false,
      requestsPhoto: false,
    },
  };
}

function chatButton(
  requestId: number,
  botAdministratorRights?: ReadonlySet<'can_manage_chat' | 'can_invite_users'>,
): ReplyKeyboardButton {
  return {
    text: 'Duplicate',
    request: {
      kind: 'chat',
      requestId,
      chatIsChannel: false,
      chatIsCreated: false,
      ...(botAdministratorRights === undefined ? {} : { botAdministratorRights }),
      botIsMember: true,
      requestsTitle: false,
      requestsUsername: false,
      requestsPhoto: false,
    },
  };
}

function keyboardOf(rows: ReplyKeyboardButton[][]): ReplyKeyboard {
  return {
    kind: 'reply_keyboard',
    rows,
    isPersistent: false,
    resizesToFit: false,
    isOneTime: false,
    isSelective: false,
  };
}

function expectSelected(
  selection: ReplyKeyboardButtonSelection,
  expected: ReplyKeyboardButton,
  description: string,
): void {
  if (!selection.selected || selection.button !== expected) {
    throw new Error(`Expected ${description} to select its button: ${JSON.stringify(selection)}`);
  }
}

function expectRefused(
  selection: ReplyKeyboardButtonSelection,
  expectedReason: string,
  description: string,
): void {
  if (selection.selected || selection.reason !== expectedReason) {
    throw new Error(
      `Expected ${description} to be refused with ${expectedReason}: ${JSON.stringify(selection)}`,
    );
  }
}

Deno.test('a press selects the button that takes its answer in any order and row', () => {
  const answerKinds: Array<[ReplyKeyboardButton, ReplyKeyboardRequestAnswer['kind']]> = [
    [locationButton, 'location'],
    [usersButton(1), 'users'],
    [chatButton(2), 'chat'],
    [quizButton, 'poll'],
    [webAppButton, 'web_app'],
  ];
  for (const [requestButton, answerKind] of answerKinds) {
    const arrangements: Array<[string, ReplyKeyboardButton[][]]> = [
      ['after a text button', [[plainButton, requestButton]]],
      ['before a text button', [[requestButton, plainButton]]],
      ['a row below a text button', [[plainButton], [requestButton]]],
      ['a row above a text button', [[requestButton], [plainButton]]],
    ];
    for (const [arrangement, rows] of arrangements) {
      const keyboard = keyboardOf(rows);
      const description = `a ${answerKind} button ${arrangement}`;
      expectSelected(
        selectReplyKeyboardButton(keyboard, 'Duplicate', answerKind),
        requestButton,
        `an answer to ${description}`,
      );
      expectSelected(
        selectReplyKeyboardButton(keyboard, 'Duplicate', undefined),
        plainButton,
        `a press without an answer beside ${description}`,
      );
    }
  }
  const contactAndWebApp = keyboardOf([[contactButton], [webAppButton]]);
  expectSelected(
    selectReplyKeyboardButton(contactAndWebApp, 'Duplicate', undefined),
    contactButton,
    'a press without an answer beside a Web App button',
  );
  expectSelected(
    selectReplyKeyboardButton(contactAndWebApp, 'Duplicate', 'web_app'),
    webAppButton,
    'Web App data beside a contact button',
  );
});

Deno.test('a press is refused when no button with its text takes its answer', () => {
  const keyboard = keyboardOf([[plainButton, locationButton], [{ text: 'Other' }]]);
  expectRefused(
    selectReplyKeyboardButton(keyboard, 'Missing', undefined),
    'reply_keyboard_button_not_found',
    'a text no button has',
  );
  expectRefused(
    selectReplyKeyboardButton(keyboard, 'Other', 'location'),
    'reply_keyboard_button_answer_not_requested',
    'a location for a text button with another label',
  );
  expectRefused(
    selectReplyKeyboardButton(keyboard, 'Duplicate', 'web_app'),
    'reply_keyboard_button_answer_not_requested',
    'Web App data that no button with the text takes',
  );
  expectRefused(
    selectReplyKeyboardButton(keyboardOf([[locationButton, webAppButton]]), 'Duplicate', undefined),
    'reply_keyboard_button_answer_missing',
    'no answer when every button with the text requests one',
  );
});

Deno.test('a press is refused when buttons that take its answer request different things', () => {
  const ambiguousKeyboards: Array<
    [string, ReplyKeyboardButton[][], ReplyKeyboardRequestAnswer['kind'] | undefined]
  > = [
    ['a text and a contact button', [[plainButton], [contactButton]], undefined],
    ['users requests with different IDs', [[usersButton(1), usersButton(2)]], 'users'],
    ['users requests with different criteria', [[usersButton(1), usersButton(1, 2)]], 'users'],
    [
      'chat requests with different rights',
      [[chatButton(1, new Set(['can_manage_chat'])), chatButton(1)]],
      'chat',
    ],
    [
      'poll requests of different types',
      [[quizButton, { text: 'Duplicate', request: { kind: 'poll' } }]],
      'poll',
    ],
    [
      'Web Apps at different URLs',
      [[webAppButton], [{
        text: 'Duplicate',
        request: { kind: 'web_app', url: 'https://example.com/other' },
      }]],
      'web_app',
    ],
  ];
  for (const [description, rows, answerKind] of ambiguousKeyboards) {
    expectRefused(
      selectReplyKeyboardButton(
        keyboardOf([[plainButton, locationButton], ...rows]),
        'Duplicate',
        answerKind,
      ),
      'reply_keyboard_button_ambiguous',
      description,
    );
  }
});

Deno.test('a press selects the first of buttons that request the same thing', () => {
  const sameButtons: Array<
    [string, ReplyKeyboardButton, ReplyKeyboardRequestAnswer['kind'] | undefined]
  > = [
    ['text buttons', plainButton, undefined],
    ['contact buttons', contactButton, undefined],
    ['users requests', usersButton(1), 'users'],
    ['chat requests', chatButton(1, new Set(['can_manage_chat', 'can_invite_users'])), 'chat'],
    ['Web Apps at one URL', webAppButton, 'web_app'],
  ];
  for (const [description, button, answerKind] of sameButtons) {
    // An equal copy, styled differently, stands for a second button that requests the same thing.
    const sameRequestButton: ReplyKeyboardButton = structuredClone({ ...button, style: 'danger' });
    expectSelected(
      selectReplyKeyboardButton(
        keyboardOf([[button], [sameRequestButton]]),
        'Duplicate',
        answerKind,
      ),
      button,
      description,
    );
  }
});
