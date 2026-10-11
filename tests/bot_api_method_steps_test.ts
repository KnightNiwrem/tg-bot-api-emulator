/**
 * The composition of a Bot API method's steps: they run in order, the first that answers the call
 * ends it, and a method of steps executes its command only once its call's transaction runs it.
 */
import { assertEquals } from '@std/assert';
import { z } from 'zod';

import { createEmulationSession } from '../src/composition/emulation_session.ts';
import {
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../src/api/sessions/bot_api/method_call.ts';
import {
  answerWith,
  type BotApiStepResult,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
} from '../src/api/sessions/bot_api/method_steps.ts';
import { integerParameter } from '../src/api/sessions/bot_api/request_parameters.ts';
import { createSystemSessionTiming } from '../src/timing/system_timing.ts';

Deno.test('steps run in order, each reading what the step before it produced', () => {
  const ranSteps: string[] = [];
  const step = (name: string) => (value: readonly string[]): BotApiStepResult<string[]> => {
    ranSteps.push(name);
    return proceedWith([...value, name]);
  };

  const { result } = startSteps<readonly string[]>([]).andThen(step('first'))
    .andThen(step('second'));

  assertEquals([result, ranSteps], [
    { proceeds: true, value: ['first', 'second'] },
    ['first', 'second'],
  ]);
});

Deno.test('the first step that answers the call ends it, so no later step runs', () => {
  const ranSteps: string[] = [];
  const refusal = botApiError(400, 'Bad Request: refused by the first step');

  const { result } = startSteps(1)
    .andThen((value) => {
      ranSteps.push('refusing');
      return value === 1 ? answerWith(refusal) : proceedWith(value);
    })
    .andThen((value) => {
      ranSteps.push('later');
      return proceedWith(value + 1);
    });

  assertEquals([result, ranSteps], [{ proceeds: false, answer: refusal }, ['refusing']]);
});

const PARAMETERS_SCHEMA = z.strictObject({ count: integerParameter(z.int()).optional() });

/** A method of steps that requires `count` and answers it, recording when its command runs. */
function createCountingMethod(executions: number[]) {
  return commandMethodOfSteps({
    name: 'countThings',
    recordsActivity: true,
    parameters: PARAMETERS_SCHEMA,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen(({ count }) =>
        count === undefined
          ? answerWith(botApiError(400, 'Bad Request: count is empty'))
          : proceedWith(count)
      ),
    execute: (_context, count) => {
      executions.push(count);
      return botApiResult(count);
    },
  });
}

Deno.test('a method of steps refuses parameters its schema does not fit, naming their path', async () => {
  const executions: number[] = [];
  const method = createCountingMethod(executions);
  if (!('prepare' in method)) {
    throw new Error('Expected a method of steps to execute as a command');
  }
  const context = createMethodContext();

  const answers = [
    await method.prepare(context, { count: 'many' }, new Map()),
    await method.prepare(context, { count: '1', extra: '2' }, new Map()),
    await method.prepare(context, {}, new Map()),
  ];

  assertEquals(
    [answers, executions],
    [
      [
        answered(400, 'Bad Request: invalid countThings parameters: count'),
        answered(400, 'Bad Request: invalid countThings parameters: extra'),
        answered(400, 'Bad Request: count is empty'),
      ],
      [],
    ],
    'Expected each refusal from the first step that refuses, with nothing executed',
  );
});

Deno.test('a method of steps executes its command only when its call executes it', async () => {
  const executions: number[] = [];
  const method = createCountingMethod(executions);
  if (!('prepare' in method)) {
    throw new Error('Expected a method of steps to execute as a command');
  }

  const preparation = await method.prepare(createMethodContext(), { count: '3' }, new Map());
  const executionsAfterPreparation = [...executions];
  const answer = typeof preparation === 'object' && preparation.kind === 'command'
    ? preparation.execute()
    : undefined;

  assertEquals([executionsAfterPreparation, answer, executions], [[], botApiResult(3), [3]]);
});

/** The context of a call by a bot of a new session. */
function createMethodContext(): BotApiMethodContext {
  const session = createEmulationSession(
    'method-steps',
    { uploadProfile: 'cloud' },
    createSystemSessionTiming(),
  );
  const bot = session.virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!bot.created) {
    throw new Error('Expected the bot to be created');
  }
  return { session, bot: bot.bot.profile, signal: session.lifetime.endSignal };
}

function answered(status: 400, description: string) {
  const answer: BotApiMethodAnswer = botApiError(status, description);
  return { kind: 'answered', answer };
}
