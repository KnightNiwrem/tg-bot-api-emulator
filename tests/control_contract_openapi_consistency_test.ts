/**
 * The control operations' contracts and the hand-written OpenAPI document describe each operation
 * alike: its route, parameters, request body, statuses, headers and bodies. Neither is generated
 * from the other, so this check is what keeps them in step.
 */
import { assertEquals } from '@std/assert';
import { z } from 'zod';

import { createAccountContract } from '../src/api/contracts/accounts.ts';
import { readBotActivityContract } from '../src/api/contracts/bot_activity.ts';
import { downloadFileContract } from '../src/api/contracts/files.ts';
import { createBotContract } from '../src/api/contracts/bots.ts';
import { controlRefusalSchema } from '../src/api/contracts/control_errors.ts';
import {
  type ControlOperationContract,
  defineControlOperation,
} from '../src/api/contracts/operation_contract.ts';
import {
  listRateLimitResponsesContract,
  listServerErrorResponsesContract,
  queueRateLimitResponsesContract,
  queueServerErrorResponsesContract,
} from '../src/api/contracts/queued_bot_api_answers.ts';
import { createSessionContract, deleteSessionContract } from '../src/api/contracts/sessions.ts';
import {
  changeSupergroupDescriptionContract,
  changeSupergroupTitleContract,
  demoteSupergroupMemberContract,
  expireSupergroupMemberRestrictionContract,
  getSupergroupAdministratorsContract,
  liftSupergroupMemberRestrictionContract,
  promoteSupergroupMemberContract,
  protectSupergroupContentContract,
  restrictSupergroupMemberContract,
  setSupergroupCustomTitleContract,
  setSupergroupDefaultPermissionsContract,
  unprotectSupergroupContentContract,
} from '../src/api/contracts/supergroup_administration.ts';
import {
  addSupergroupMemberContract,
  createSupergroupContract,
  decideSupergroupJoinRequestContract,
  expireChatInviteLinkContract,
  expireJoinRequesterContactContract,
  getSupergroupInviteLinksContract,
  getSupergroupJoinRequestsContract,
  joinChatByInviteLinkContract,
  removeSupergroupMemberContract,
} from '../src/api/contracts/supergroups.ts';
import {
  expireWebhookAttemptContract,
  getWebhookDeliveryContract,
  listWebhookAttemptsContract,
  releaseWebhookRetryContract,
  setWebhookDeliveryContract,
} from '../src/api/contracts/webhook_attempts.ts';
import { registerWebResourceContract } from '../src/api/contracts/web_resources.ts';
import { expirePollContract } from '../src/api/contracts/polls.ts';
import {
  answerAccountPollContract,
  answerSupergroupAccountPollContract,
  getAccountPollAnswerContract,
  getSupergroupAccountPollAnswerContract,
  retractAccountPollAnswerContract,
  retractSupergroupAccountPollAnswerContract,
  stopAccountPollContract,
  stopSupergroupAccountPollContract,
} from '../src/api/contracts/poll_answers.ts';
import {
  deleteAccountMessageContract,
  deleteSupergroupAccountMessageContract,
  editAccountMessageContract,
  editSupergroupAccountMessageContract,
  getPrivateMessageHistoryContract,
  getSupergroupMessageHistoryContract,
} from '../src/api/contracts/account_messages.ts';
import {
  getPrivatePinnedMessagesContract,
  getSupergroupPinnedMessagesContract,
  pinPrivateMessageContract,
  pinSupergroupMessageContract,
  unpinPrivateMessageContract,
  unpinSupergroupMessageContract,
} from '../src/api/contracts/pinned_messages.ts';
import {
  expirePrivateChatActionContract,
  expireSupergroupChatActionContract,
  getPrivateChatActionsContract,
  getSupergroupChatActionsContract,
} from '../src/api/contracts/chat_actions.ts';
import {
  getPrivateChatBotCommandsContract,
  getPrivateChatMenuButtonContract,
  getPrivateChatNotificationsContract,
  getPrivateChatReplyInterfaceContract,
  getSupergroupBotCommandsContract,
  getSupergroupNotificationsContract,
  getSupergroupReplyInterfaceContract,
} from '../src/api/contracts/conversation_reads.ts';
import {
  getSupergroupMessageReactionsContract,
  removeSupergroupAccountMessageReactionContract,
  setSupergroupAccountMessageReactionContract,
} from '../src/api/contracts/message_reactions.ts';
import {
  chooseInlineQueryResultContract,
  expireInlineAnswerCacheContract,
  getInlineQueryContract,
  sendInlineQueryContract,
} from '../src/api/contracts/inline_queries.ts';
import {
  sendAccountMediaGroupContract,
  sendAccountMessageContract,
} from '../src/api/contracts/message_sending.ts';
import { pressReplyKeyboardButtonContract } from '../src/api/contracts/reply_keyboard_presses.ts';
import { blockBotContract, unblockBotContract } from '../src/api/contracts/blocked_bots.ts';
import {
  getCallbackQueryContract,
  pressCallbackButtonContract,
} from '../src/api/contracts/callback_queries.ts';
import {
  abandonCheckoutAttemptContract,
  expireCheckoutAttemptContract,
  getCheckoutAttemptContract,
  submitCheckoutContract,
} from '../src/api/contracts/checkouts.ts';
import {
  expirePrivateMessageDraftContract,
  getPrivateMessageDraftContract,
  stopPrivateMessageDraftContract,
} from '../src/api/contracts/message_drafts.ts';
import { findContractDrift } from './support/control_contract_consistency/contract_drift.ts';
import { JsonSchemaCanonicalizer } from './support/control_contract_consistency/json_schema_canonical_form.ts';
import { readWireJsonSchema } from './support/control_contract_consistency/wire_json_schema.ts';
import { JsonSchemaValidator } from './support/openapi_conformance/json_schema_validator.ts';
import {
  type DocumentedOperation,
  readOpenApiDocument,
} from './support/openapi_conformance/openapi_document.ts';

/** Every operation the control API declares a contract for. */
const CONTROL_OPERATION_CONTRACTS: readonly ControlOperationContract[] = [
  createSessionContract,
  deleteSessionContract,
  createBotContract,
  createAccountContract,
  readBotActivityContract,
  createSupergroupContract,
  addSupergroupMemberContract,
  removeSupergroupMemberContract,
  joinChatByInviteLinkContract,
  getSupergroupInviteLinksContract,
  getSupergroupJoinRequestsContract,
  decideSupergroupJoinRequestContract,
  expireChatInviteLinkContract,
  expireJoinRequesterContactContract,
  downloadFileContract,
  getSupergroupAdministratorsContract,
  promoteSupergroupMemberContract,
  demoteSupergroupMemberContract,
  setSupergroupCustomTitleContract,
  restrictSupergroupMemberContract,
  liftSupergroupMemberRestrictionContract,
  setSupergroupDefaultPermissionsContract,
  protectSupergroupContentContract,
  unprotectSupergroupContentContract,
  changeSupergroupTitleContract,
  changeSupergroupDescriptionContract,
  expireSupergroupMemberRestrictionContract,
  queueRateLimitResponsesContract,
  listRateLimitResponsesContract,
  queueServerErrorResponsesContract,
  listServerErrorResponsesContract,
  getWebhookDeliveryContract,
  setWebhookDeliveryContract,
  listWebhookAttemptsContract,
  releaseWebhookRetryContract,
  expireWebhookAttemptContract,
  registerWebResourceContract,
  expirePollContract,
  retractAccountPollAnswerContract,
  retractSupergroupAccountPollAnswerContract,
  sendInlineQueryContract,
  getInlineQueryContract,
  expireInlineAnswerCacheContract,
  blockBotContract,
  unblockBotContract,
  pressCallbackButtonContract,
  getCallbackQueryContract,
  getPrivateMessageDraftContract,
  expirePrivateMessageDraftContract,
  stopPrivateMessageDraftContract,
  getPrivateMessageHistoryContract,
  editAccountMessageContract,
  deleteAccountMessageContract,
  getPrivatePinnedMessagesContract,
  pinPrivateMessageContract,
  unpinPrivateMessageContract,
  getPrivateChatActionsContract,
  expirePrivateChatActionContract,
  getPrivateChatBotCommandsContract,
  getPrivateChatMenuButtonContract,
  getPrivateChatNotificationsContract,
  getPrivateChatReplyInterfaceContract,
  getAccountPollAnswerContract,
  answerAccountPollContract,
  stopAccountPollContract,
  getSupergroupMessageHistoryContract,
  editSupergroupAccountMessageContract,
  deleteSupergroupAccountMessageContract,
  getSupergroupPinnedMessagesContract,
  pinSupergroupMessageContract,
  unpinSupergroupMessageContract,
  getSupergroupChatActionsContract,
  expireSupergroupChatActionContract,
  getSupergroupBotCommandsContract,
  getSupergroupNotificationsContract,
  getSupergroupReplyInterfaceContract,
  getSupergroupAccountPollAnswerContract,
  answerSupergroupAccountPollContract,
  stopSupergroupAccountPollContract,
  getSupergroupMessageReactionsContract,
  setSupergroupAccountMessageReactionContract,
  removeSupergroupAccountMessageReactionContract,
  sendAccountMessageContract,
  sendAccountMediaGroupContract,
  pressReplyKeyboardButtonContract,
  chooseInlineQueryResultContract,
  submitCheckoutContract,
  getCheckoutAttemptContract,
  abandonCheckoutAttemptContract,
  expireCheckoutAttemptContract,
];

const document = readOpenApiDocument();
const canonicalizer = new JsonSchemaCanonicalizer(
  document.schemaFiles,
  new JsonSchemaValidator(new Map()),
);

for (const contract of CONTROL_OPERATION_CONTRACTS) {
  Deno.test(`The ${contract.operationId} contract agrees with the OpenAPI document`, () => {
    const drift = findContractDrift(contract, document.operations, canonicalizer);
    if (drift.length > 0) {
      throw new Error(`Expected no drift for ${contract.operationId}:\n${drift.join('\n')}`);
    }
  });
}

Deno.test('A field only the contract has, or only the document has, is drift', () => {
  const documented = findOperation('createAccount');
  const contractWithNickname = defineControlOperation({
    ...createAccountContract,
    body: {
      required: true,
      schema: z.strictObject({ first_name: z.string().min(1).max(64), nickname: z.string() }),
    },
  });

  const drift = findContractDrift(contractWithNickname, [documented], canonicalizer);

  for (
    const expected of [
      'request body /properties/nickname: the contract has {"type":"string"}, the document has nothing',
      'request body /properties/phone_number: the contract has nothing, the document has',
    ]
  ) {
    if (!drift.some((difference) => difference.startsWith(expected))) {
      throw new Error(`Expected drift starting ${expected}, found:\n${drift.join('\n')}`);
    }
  }
});

Deno.test('A changed limit, default or required field is drift', () => {
  const documented = findOperation('createSession');
  const contract = defineControlOperation({
    ...createSessionContract,
    body: {
      required: true,
      schema: z.strictObject({ upload_profile: z.enum(['cloud', 'local']).default('local') }),
    },
  });
  const accountContract = defineControlOperation({
    ...createAccountContract,
    body: {
      ...createAccountContract.body,
      schema: createAccountContract.body.schema.extend({ first_name: z.string().min(1).max(65) }),
    },
  });

  const drift = [
    ...findContractDrift(contract, [documented], canonicalizer),
    ...findContractDrift(accountContract, [findOperation('createAccount')], canonicalizer),
  ];

  assertDrift(drift, [
    'request body: the contract requires it',
    'request body /properties/upload_profile/default: the contract has "local", the document has "cloud"',
    'request body /properties/first_name/maxLength: the contract has 65, the document has 64',
  ]);
});

Deno.test('A status, reason or header only one side declares is drift', () => {
  const documented = findOperation('createBot');
  const contract = defineControlOperation({
    ...createBotContract,
    success: { ...createBotContract.success, headers: undefined },
    refusals: {
      400: createBotContract.refusals[400],
      404: createBotContract.refusals[404],
      409: controlRefusalSchema(['username_taken', 'username_reserved']),
      422: controlRefusalSchema(['bot_unwanted']),
    },
  });

  const drift = findContractDrift(contract, [documented], canonicalizer);

  assertDrift(drift, [
    'response 507: only the document has it',
    'response 422: only the contract has it',
    'response 201 header location: only the document has it',
    'response 409 /properties/reason/const: the contract has nothing, the document has "username_taken"',
    'response 409 /properties/reason/enum: the contract has ["username_reserved","username_taken"], the document has nothing',
  ]);
});

Deno.test('An action receipt only one side declares is drift', () => {
  const contractWithoutReceipt = defineControlOperation({
    ...createBotContract,
    success: { ...createBotContract.success, actionReceipt: undefined },
  });
  const contractWithReceipt = defineControlOperation({
    ...deleteSessionContract,
    success: { ...deleteSessionContract.success, actionReceipt: 'before_action' },
  });

  const drift = [
    ...findContractDrift(contractWithoutReceipt, [findOperation('createBot')], canonicalizer),
    ...findContractDrift(contractWithReceipt, [findOperation('deleteSession')], canonicalizer),
  ];

  assertDrift(drift, [
    'response 201 header action-receipt-session-id: only the document has it',
    'response 201 header action-receipt-activity-position: only the document has it',
    'response 204 header action-receipt-session-id: only the contract has it',
    'response 204 header action-receipt-activity-position: only the contract has it',
  ]);
});

Deno.test('A header the contract declares in two letter cases is drift', () => {
  const documented = findOperation('createBot');
  // A contract that `defineControlOperation` would refuse, compared as it stands.
  const contract: ControlOperationContract = {
    ...createBotContract,
    success: {
      ...createBotContract.success,
      headers: z.object({ Location: z.string(), location: z.string() }),
    },
  };

  const drift = findContractDrift(contract, [documented], canonicalizer);

  if (!drift.includes('response 201 header location: the contract declares it twice')) {
    throw new Error(`Expected the repeated header as drift, found:\n${drift.join('\n')}`);
  }
});

Deno.test('A wire schema whose JSON Schema would leave out a check is refused', () => {
  const cases: readonly (readonly [label: string, schema: z.ZodType])[] = [
    ['a refinement', z.strictObject({ name: z.string().refine((name) => name !== 'root') })],
    ['a transform', z.strictObject({ count: z.string().transform(Number) })],
    ['a coercion', z.strictObject({ count: z.coerce.number() })],
  ];
  for (const [label, schema] of cases) {
    let refused = false;
    try {
      readWireJsonSchema(schema, 'input');
    } catch {
      refused = true;
    }
    if (!refused) throw new Error(`Expected a wire schema with ${label} to be refused`);
  }
});

function findOperation(operationId: string): DocumentedOperation {
  const operation = document.operations.find((item) => item.operationId === operationId);
  if (operation === undefined) throw new Error(`The document has no operation ${operationId}`);
  return operation;
}

function assertDrift(drift: readonly string[], expected: readonly string[]): void {
  const sortedDrift = [...drift].sort();
  const sortedExpected = [...expected].sort();
  assertEquals(
    sortedDrift,
    sortedExpected,
    `Expected exactly this drift:\n${sortedExpected.join('\n')}\nfound:\n${sortedDrift.join('\n')}`,
  );
}
