import { describe, expect, it } from 'vitest';
import { beginPendingAction, isTimedOut, markPending, transitionPending } from './pendingAction';
describe('pending actions', () => {
  it('keeps transitions tied to the submitting action', () => {
    const action = markPending(beginPendingAction('start', {}, 1), { goal: 'reward-share', signature: 'sig' });
    expect(transitionPending(action, 2, 'confirmed')).toBeNull();
    expect(transitionPending(action, action.submittedAt, 'confirmed')?.phase).toBe('confirmed');
  });
  it('times out after ten minutes', () => expect(isTimedOut(beginPendingAction('join', {}, 1), 600001)).toBe(true));
});
