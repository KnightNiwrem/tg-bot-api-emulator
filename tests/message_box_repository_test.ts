import { MessageBoxRepository } from '../src/repositories/message_box/message_box.ts';

Deno.test('MessageBoxRepository numbers each owner message box independently and resolves IDs back', () => {
  const messageBoxes = new MessageBoxRepository();

  const assignedMessageIds = [
    messageBoxes.assignMessageId(1, 'first'),
    messageBoxes.assignMessageId(2, 'first'),
    messageBoxes.assignMessageId(1, 'second'),
  ];

  if (assignedMessageIds.join() !== '1,1,2') {
    throw new Error('Expected each owner message box to start at 1 and increase independently');
  }
  if (
    messageBoxes.getMessageId(1, 'first') !== 1 ||
    messageBoxes.getMessageId(2, 'first') !== 1 ||
    messageBoxes.getMessageId(1, 'second') !== 2
  ) {
    throw new Error('Expected lookups to return the assigned message IDs');
  }
  if (
    messageBoxes.getMessageId(2, 'second') !== undefined ||
    messageBoxes.getMessageId(3, 'first') !== undefined
  ) {
    throw new Error('Expected messages outside an owner message box to have no message ID');
  }
  if (
    messageBoxes.getCanonicalMessageId(1, 1) !== 'first' ||
    messageBoxes.getCanonicalMessageId(2, 1) !== 'first' ||
    messageBoxes.getCanonicalMessageId(1, 2) !== 'second'
  ) {
    throw new Error("Expected each box's message IDs to resolve to its own canonical messages");
  }
  if (
    messageBoxes.getCanonicalMessageId(2, 2) !== undefined ||
    messageBoxes.getCanonicalMessageId(3, 1) !== undefined
  ) {
    throw new Error('Expected unassigned message IDs to resolve to nothing');
  }
});

Deno.test('MessageBoxRepository rejects assigning a message twice in one box', () => {
  const messageBoxes = new MessageBoxRepository();
  messageBoxes.assignMessageId(1, 'first');

  let rejected = false;
  try {
    messageBoxes.assignMessageId(1, 'first');
  } catch {
    rejected = true;
  }

  if (!rejected || messageBoxes.assignMessageId(1, 'second') !== 2) {
    throw new Error('Expected a repeated assignment to fail without consuming a message ID');
  }
});
