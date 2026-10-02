import { createEmulationSession } from '../src/composition/emulation_session.ts';
import { SessionRepository } from '../src/repositories/session.ts';

Deno.test('SessionRepository stores and retrieves a session without overwriting its ID', () => {
  const sessions = new SessionRepository();
  const originalSession = createEmulationSession('test-session', { uploadProfile: 'cloud' });
  const replacementSession = createEmulationSession('test-session', { uploadProfile: 'cloud' });

  if (!sessions.add(originalSession)) {
    throw new Error('Expected the session to be added');
  }
  if (sessions.add(replacementSession)) {
    throw new Error('Expected a duplicate session ID not to overwrite the stored session');
  }
  if (sessions.getById(originalSession.id) !== originalSession) {
    throw new Error('Expected ID lookup to return the original session');
  }
  if (!sessions.deleteById(originalSession.id)) {
    throw new Error('Expected the stored session to be deleted');
  }
  if (sessions.getById(originalSession.id) !== undefined) {
    throw new Error('Expected the deleted session not to be retrievable');
  }
});
