import type { z } from 'zod';

import {
  describeInvalidMethodParameters,
  invalidMethodParametersAnswer,
} from './errors/invalid_parameters.ts';
import {
  answeredPreparation,
  type BotApiCallPreparation,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
} from './method_call.ts';
import type { BotApiRequestParameters, BotApiUploadedFiles } from './request_parameters.ts';

/**
 * What one step of a call produced: the value that the steps after it read, or the answer that ends
 * the call there, such as Telegram's refusal of what the step read.
 */
export type BotApiStepResult<Value> =
  | { readonly proceeds: true; readonly value: Value }
  | { readonly proceeds: false; readonly answer: BotApiMethodAnswer };

/** A step's result that lets the call proceed with `value`. */
export function proceedWith<Value>(value: Value): BotApiStepResult<Value> {
  return { proceeds: true, value };
}

/** A step's result that ends the call with `answer`. */
export function answerWith(answer: BotApiMethodAnswer): BotApiStepResult<never> {
  return { proceeds: false, answer };
}

/**
 * A step's result that ends the call with a `400` error, as a reader describes what it could not
 * read.
 */
export function answerWithBadRequest(description: string): BotApiStepResult<never> {
  return answerWith(botApiError(400, description));
}

/**
 * A call's steps, composed in the order they run, which is the order in which the official Bot API
 * server and TDLib check the call. Each step reads what the steps before it produced, and the first
 * step that answers the call ends it, so no later step runs.
 */
export interface BotApiSteps<Value> {
  /** Runs `step` next, with the value the steps so far produced, unless one answered the call. */
  andThen<Next>(step: (value: Value) => BotApiStepResult<Next>): BotApiSteps<Next>;
  /** What the steps so far produced, or the answer one of them gave the call. */
  readonly result: BotApiStepResult<Value>;
}

/** Steps that start from `value`, such as a call's parameters as its method's schema read them. */
export function startSteps<Value>(value: Value): BotApiSteps<Value> {
  return stepsFrom(proceedWith(value));
}

function stepsFrom<Value>(result: BotApiStepResult<Value>): BotApiSteps<Value> {
  return {
    andThen: <Next>(step: (value: Value) => BotApiStepResult<Next>) =>
      stepsFrom(result.proceeds ? step(result.value) : result),
    result,
  };
}

/** A call of a method, as its steps read it once its parameters fit the method's schema. */
export interface BotApiStepCall<Parameters> {
  readonly context: BotApiMethodContext;
  readonly parameters: Parameters;
  readonly uploadedFiles: BotApiUploadedFiles;
  /**
   * The method's description of parameters that do not fit it, without a path, which a reader
   * answers for a value it refuses after the schema, such as an unknown field of JSON it reads.
   */
  readonly invalidParametersDescription: string;
}

/**
 * A method composed of steps. Its first step reads the call's parameters with `parameters`,
 * refusing parameters that do not fit with `invalidMethodParametersAnswer`, which names the first
 * offending parameter's path. `steps` then read what `execute` needs, in the order in which the
 * official server and TDLib check the call.
 */
interface BotApiMethodOfSteps<Schema extends z.ZodType, Prepared> {
  readonly name: string;
  readonly recordsActivity: boolean;
  readonly parameters: Schema;
  readonly steps: (call: BotApiStepCall<z.output<Schema>>) => BotApiSteps<Prepared>;
}

/**
 * A method whose steps prepare a command that its call's transaction executes, as
 * `BotApiCommandPreparer` describes: the steps read without changing the session.
 */
export interface BotApiCommandMethodOfSteps<Schema extends z.ZodType, Prepared>
  extends BotApiMethodOfSteps<Schema, Prepared> {
  /**
   * Checks every condition that depends on the session's state, then changes the session and
   * answers the call, as a command's `execute` does.
   */
  readonly execute: (context: BotApiMethodContext, prepared: Prepared) => BotApiMethodAnswer;
}

/** The method record of a method that `BotApiCommandMethodOfSteps` defines. */
export function commandMethodOfSteps<Schema extends z.ZodType, Prepared>(
  { execute, ...method }: BotApiCommandMethodOfSteps<Schema, Prepared>,
): BotApiMethod {
  return {
    name: method.name,
    recordsActivity: method.recordsActivity,
    prepare: (context, parameters, uploadedFiles): BotApiCallPreparation => {
      const result = runSteps(method, context, parameters, uploadedFiles);
      return result.proceeds
        ? { kind: 'command', execute: () => execute(context, result.value) }
        : answeredPreparation(result.answer);
    },
  };
}

/**
 * A method whose handler runs its steps, then `execute`, which answers the call and commits its
 * own changes, as a `BotApiMethodHandler` does.
 */
export interface BotApiHandledMethodOfSteps<Schema extends z.ZodType, Prepared>
  extends BotApiMethodOfSteps<Schema, Prepared> {
  readonly execute: (context: BotApiMethodContext, prepared: Prepared) => BotApiMethodAnswer;
}

/** The method record of a method that `BotApiHandledMethodOfSteps` defines. */
export function handledMethodOfSteps<Schema extends z.ZodType, Prepared>(
  { execute, ...method }: BotApiHandledMethodOfSteps<Schema, Prepared>,
): BotApiMethod {
  return {
    name: method.name,
    recordsActivity: method.recordsActivity,
    handler: (context, parameters, uploadedFiles): BotApiMethodAnswer => {
      const result = runSteps(method, context, parameters, uploadedFiles);
      return result.proceeds ? execute(context, result.value) : result.answer;
    },
  };
}

/** Reads a call's parameters with its method's schema, then runs the method's steps. */
function runSteps<Schema extends z.ZodType, Prepared>(
  { name, parameters: parametersSchema, steps }: BotApiMethodOfSteps<Schema, Prepared>,
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiStepResult<Prepared> {
  const parsedParameters = parametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answerWith(invalidMethodParametersAnswer(name, parsedParameters.error));
  }
  return steps({
    context,
    parameters: parsedParameters.data,
    uploadedFiles,
    invalidParametersDescription: describeInvalidMethodParameters(name),
  }).result;
}
