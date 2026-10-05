import type { NewPoll, Poll, PollId } from '../types/poll.ts';
import type { FormattedText } from '../types/virtual_message.ts';

/** Poll identifiers are positive signed 64-bit integers. */
const MAX_POLL_ID = (1n << 63n) - 1n;

/**
 * Stores polls under session-unique identifiers, with each voter's answer. Messages refer to a
 * poll by its identifier; a poll stays stored after the messages showing it are deleted, until the
 * session ends.
 */
export class PollRepository {
  readonly #pollsById = new Map<PollId, Poll>();

  /** Stores a new poll without votes under an identifier that no poll of the session had. */
  addPoll(newPoll: NewPoll): Poll {
    let pollId: PollId;
    do {
      const [randomBits] = crypto.getRandomValues(new BigUint64Array(1));
      pollId = String(randomBits & MAX_POLL_ID);
    } while (pollId === '0' || this.#pollsById.has(pollId));

    const poll: Poll = {
      id: pollId,
      creator: { ...newPoll.creator },
      question: copyFormattedText(newPoll.question),
      options: newPoll.optionTexts.map((text, optionPosition) => ({
        persistentId: String(optionPosition),
        text: copyFormattedText(text),
      })),
      isAnonymous: newPoll.isAnonymous,
      allowsMultipleAnswers: newPoll.allowsMultipleAnswers,
      allowsRevoting: newPoll.allowsRevoting,
      type: newPoll.type.kind === 'regular' ? { kind: 'regular' } : {
        kind: 'quiz',
        correctOptionPositions: [...newPoll.type.correctOptionPositions],
        explanation: copyFormattedText(newPoll.type.explanation),
      },
      isClosed: newPoll.isClosed,
      ...(newPoll.closingTime === undefined ? {} : { closingTime: { ...newPoll.closingTime } }),
      answersByVoterId: new Map(),
    };
    this.#pollsById.set(poll.id, poll);
    return poll;
  }

  getPoll(pollId: PollId): Poll | undefined {
    return this.#pollsById.get(pollId);
  }

  /**
   * Replaces a voter's answer to a stored poll with the chosen option positions, in increasing
   * order, and returns the poll as the answer left it; no positions retract the voter's answer.
   */
  setVoterAnswer(pollId: PollId, voterId: number, chosenOptionPositions: readonly number[]): Poll {
    const poll = this.#pollsById.get(pollId);
    if (poll === undefined) {
      throw new Error(`Poll ${pollId} does not exist`);
    }
    const answersByVoterId = new Map(poll.answersByVoterId);
    if (chosenOptionPositions.length === 0) {
      answersByVoterId.delete(voterId);
    } else {
      answersByVoterId.set(voterId, [...chosenOptionPositions]);
    }
    const answeredPoll: Poll = { ...poll, answersByVoterId };
    this.#pollsById.set(pollId, answeredPoll);
    return answeredPoll;
  }

  /**
   * Closes a stored poll, which keeps its answers and its closing time, and returns the closed
   * poll.
   */
  closePoll(pollId: PollId): Poll {
    const poll = this.#pollsById.get(pollId);
    if (poll === undefined) {
      throw new Error(`Poll ${pollId} does not exist`);
    }
    const closedPoll: Poll = { ...poll, isClosed: true };
    this.#pollsById.set(pollId, closedPoll);
    return closedPoll;
  }
}

function copyFormattedText({ text, entities }: FormattedText): FormattedText {
  return { text, entities: entities.map((entity) => ({ ...entity })) };
}
