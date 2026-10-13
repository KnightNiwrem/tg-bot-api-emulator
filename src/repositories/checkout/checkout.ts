import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../../transactions/staging/transactional_collections.ts';
import {
  type CheckoutAttempt,
  type CheckoutPayment,
  isCheckoutAttemptActive,
  type PreCheckoutQueryId,
  type UnpaidCheckoutAttemptState,
} from '../../types/checkout.ts';
import type { StarsInvoice } from '../../types/invoice.ts';
import type { CanonicalMessageId } from '../../types/virtual_message.ts';

export interface AddPendingCheckoutAttemptInput {
  readonly payerAccountId: number;
  readonly merchantBotId: number;
  readonly invoiceMessageId: CanonicalMessageId;
  readonly invoiceChatMessageId: number;
  readonly invoice: StarsInvoice;
}

/**
 * Stores checkout attempts under session-unique pre-checkout query IDs, and the active attempt and
 * the completed attempt of each invoice by the invoice's canonical message ID, which outlives the
 * deletion of the invoice and of its receipt.
 */
export class CheckoutRepository {
  readonly #staging: ChangeStaging;
  readonly #attemptsById: TransactionalMap<PreCheckoutQueryId, CheckoutAttempt>;
  readonly #activeAttemptIdsByInvoiceMessageId: TransactionalMap<
    CanonicalMessageId,
    PreCheckoutQueryId
  >;
  readonly #paidAttemptIdsByInvoiceMessageId: TransactionalMap<
    CanonicalMessageId,
    PreCheckoutQueryId
  >;
  #nextPreCheckoutQueryNumber = 1;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#attemptsById = new TransactionalMap(staging);
    this.#activeAttemptIdsByInvoiceMessageId = new TransactionalMap(staging);
    this.#paidAttemptIdsByInvoiceMessageId = new TransactionalMap(staging);
  }

  /**
   * Stores a pending attempt under a fresh query ID, as its invoice's active attempt.
   *
   * @throws {Error} when the invoice already has an active attempt, or has been paid.
   */
  addPendingAttempt(input: AddPendingCheckoutAttemptInput): CheckoutAttempt {
    const activeAttemptId = this.#activeAttemptIdsByInvoiceMessageId.get(input.invoiceMessageId);
    if (activeAttemptId !== undefined) {
      throw new Error(
        `Invoice message ${input.invoiceMessageId} already has active attempt ${activeAttemptId}`,
      );
    }
    this.#requireUnpaidInvoice(input.invoiceMessageId);
    const queryNumber = this.#nextPreCheckoutQueryNumber++;
    this.#staging.recordRevert(() => {
      this.#nextPreCheckoutQueryNumber = queryNumber;
    });
    const attempt: CheckoutAttempt = {
      id: String(queryNumber),
      payerAccountId: input.payerAccountId,
      merchantBotId: input.merchantBotId,
      invoiceMessageId: input.invoiceMessageId,
      invoiceChatMessageId: input.invoiceChatMessageId,
      invoice: input.invoice,
      state: { status: 'pending' },
    };
    this.#attemptsById.set(attempt.id, attempt);
    this.#activeAttemptIdsByInvoiceMessageId.set(attempt.invoiceMessageId, attempt.id);
    return attempt;
  }

  getAttempt(attemptId: PreCheckoutQueryId): CheckoutAttempt | undefined {
    return this.#attemptsById.get(attemptId);
  }

  /** The pending or approved attempt of an invoice, if any. */
  findActiveAttempt(invoiceMessageId: CanonicalMessageId): CheckoutAttempt | undefined {
    const attemptId = this.#activeAttemptIdsByInvoiceMessageId.get(invoiceMessageId);
    return attemptId === undefined ? undefined : this.#attemptsById.get(attemptId);
  }

  /** The completed attempt that paid an invoice, if any. */
  findPaidAttempt(invoiceMessageId: CanonicalMessageId): CheckoutAttempt | undefined {
    const attemptId = this.#paidAttemptIdsByInvoiceMessageId.get(invoiceMessageId);
    return attemptId === undefined ? undefined : this.#attemptsById.get(attemptId);
  }

  /**
   * Moves an active attempt to a new state that makes no payment, and returns the attempt as the
   * move left it. An attempt that ends stops being its invoice's active attempt.
   *
   * @throws {Error} when the attempt does not exist or has already ended.
   */
  changeActiveAttemptState(
    attemptId: PreCheckoutQueryId,
    state: UnpaidCheckoutAttemptState,
  ): CheckoutAttempt {
    const attempt = this.#requireActiveAttempt(attemptId);
    const changedAttempt: CheckoutAttempt = { ...attempt, state };
    this.#attemptsById.set(attemptId, changedAttempt);
    if (!isCheckoutAttemptActive(state)) {
      this.#activeAttemptIdsByInvoiceMessageId.delete(attempt.invoiceMessageId);
    }
    return changedAttempt;
  }

  /**
   * Completes an approved attempt with its payment, which ends it and marks its invoice paid for
   * good, and returns the attempt as completion left it.
   *
   * @throws {Error} when the attempt does not exist or is not approved, or its invoice was paid.
   */
  completeApprovedAttempt(
    attemptId: PreCheckoutQueryId,
    payment: CheckoutPayment,
  ): CheckoutAttempt {
    const attempt = this.#requireActiveAttempt(attemptId);
    if (attempt.state.status !== 'approved') {
      throw new Error(`Checkout attempt ${attemptId} is ${attempt.state.status}, not approved`);
    }
    this.#requireUnpaidInvoice(attempt.invoiceMessageId);
    const completedAttempt: CheckoutAttempt = {
      ...attempt,
      state: { status: 'completed', payment },
    };
    this.#attemptsById.set(attemptId, completedAttempt);
    this.#activeAttemptIdsByInvoiceMessageId.delete(attempt.invoiceMessageId);
    this.#paidAttemptIdsByInvoiceMessageId.set(attempt.invoiceMessageId, attemptId);
    return completedAttempt;
  }

  /** @throws {Error} when the attempt does not exist or has already ended. */
  #requireActiveAttempt(attemptId: PreCheckoutQueryId): CheckoutAttempt {
    const attempt = this.#attemptsById.get(attemptId);
    if (attempt === undefined) {
      throw new Error(`Checkout attempt ${attemptId} does not exist`);
    }
    if (!isCheckoutAttemptActive(attempt.state)) {
      throw new Error(`Checkout attempt ${attemptId} has already ended as ${attempt.state.status}`);
    }
    return attempt;
  }

  /** @throws {Error} when the invoice has been paid. */
  #requireUnpaidInvoice(invoiceMessageId: CanonicalMessageId): void {
    const paidAttemptId = this.#paidAttemptIdsByInvoiceMessageId.get(invoiceMessageId);
    if (paidAttemptId !== undefined) {
      throw new Error(`Invoice message ${invoiceMessageId} was paid by attempt ${paidAttemptId}`);
    }
  }
}
